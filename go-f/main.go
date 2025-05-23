// Copyright 2023, Modified version of pullrtmp2pushrtmp
// https://github.com/q191201771/lal
//
// Use of this source code is governed by a MIT-style license
// that can be found in the License file.

package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/q191201771/lal/pkg/base"
	"github.com/q191201771/lal/pkg/rtmp"
	"github.com/q191201771/naza/pkg/nazalog"
)

type RelayServer struct {
	server       *rtmp.Server
	pushSessions map[string][]*rtmp.PushSession
	listenAddr   string
	destUrls     map[string][]string // streamName -> destination URLs
	onPublish    func(session *rtmp.ServerSession) error
}

func NewRelayServer(listenAddr string) *RelayServer {
	rs := &RelayServer{
		listenAddr:   listenAddr,
		pushSessions: make(map[string][]*rtmp.PushSession),
		destUrls:     make(map[string][]string),
	}

	rs.server = rtmp.NewServer(listenAddr, rs)
	return rs
}

// AddDestination adds destination URLs for a specific stream name
func (rs *RelayServer) AddDestination(streamName string, destUrls []string) {
	rs.destUrls[streamName] = destUrls
}

// Start starts the relay server
func (rs *RelayServer) Start() error {
	if err := rs.server.Listen(); err != nil {
		return err
	}

	nazalog.Infof("RTMP relay server listening on %s", rs.listenAddr)

	// Run in blocking mode
	return rs.server.RunLoop()
}

// IServerObserver interface implementation
func (rs *RelayServer) OnRtmpConnect(session *rtmp.ServerSession, opa rtmp.ObjectPairArray) {
	nazalog.Infof("[%s] OnRtmpConnect, opa=%+v", session.UniqueKey(), opa)
}

func (rs *RelayServer) OnNewRtmpPubSession(session *rtmp.ServerSession) error {
	nazalog.Infof("[%s] OnNewRtmpPubSession, streamName=%s", session.UniqueKey(), session.StreamName())

	// Check if we have destination URLs for this stream
	destUrls, ok := rs.destUrls[session.StreamName()]
	if !ok {
		// If no specific destinations for this stream, use the wildcard "*" if available
		destUrls, ok = rs.destUrls["*"]
		if !ok {
			nazalog.Warnf("[%s] No destination URLs configured for stream: %s", session.UniqueKey(), session.StreamName())
			return nil
		}
	}

	// Set up a observer to receive RTMP messages
	session.SetPubSessionObserver(&RelayObserver{
		rs:         rs,
		session:    session,
		streamName: session.StreamName(),
		destUrls:   destUrls,
	})

	return nil
}

func (rs *RelayServer) OnDelRtmpPubSession(session *rtmp.ServerSession) {
	nazalog.Infof("[%s] OnDelRtmpPubSession, streamName=%s", session.UniqueKey(), session.StreamName())

	// Clean up push sessions for this stream
	streamName := session.StreamName()
	if sessions, ok := rs.pushSessions[streamName]; ok {
		for _, pushSession := range sessions {
			nazalog.Infof("[%s] Disposing push session %s", session.UniqueKey(), pushSession.UniqueKey())
			pushSession.Dispose()
		}
		delete(rs.pushSessions, streamName)
	}
}

func (rs *RelayServer) OnNewRtmpSubSession(session *rtmp.ServerSession) error {
	nazalog.Infof("[%s] OnNewRtmpSubSession, streamName=%s", session.UniqueKey(), session.StreamName())
	return nil
}

func (rs *RelayServer) OnDelRtmpSubSession(session *rtmp.ServerSession) {
	nazalog.Infof("[%s] OnDelRtmpSubSession, streamName=%s", session.UniqueKey(), session.StreamName())
}

// RelayObserver handles RTMP messages and relays them to destination servers
type RelayObserver struct {
	rs         *RelayServer
	session    *rtmp.ServerSession
	streamName string
	destUrls   []string
	started    bool
}

func (o *RelayObserver) OnReadRtmpAvMsg(msg base.RtmpMsg) {
	// Start push sessions if not already started
	if !o.started {
		o.started = true
		o.startPushSessions()
	}

	// Relay the message to all push sessions
	if sessions, ok := o.rs.pushSessions[o.streamName]; ok {
		for _, pushSession := range sessions {
			pushSession.WriteMsg(msg)
		}
	}
}

func (o *RelayObserver) startPushSessions() {
	nazalog.Infof("[%s] Starting push sessions for stream %s to %d destinations",
		o.session.UniqueKey(), o.streamName, len(o.destUrls))

	pushSessions := make([]*rtmp.PushSession, 0, len(o.destUrls))

	for _, destUrl := range o.destUrls {
		pushSession := rtmp.NewPushSession(func(option *rtmp.PushSessionOption) {
			option.PushTimeoutMs = 10000
		})

		nazalog.Infof("[%s] Starting push to %s", o.session.UniqueKey(), destUrl)
		err := pushSession.Start(destUrl)
		if err != nil {
			nazalog.Errorf("[%s] Failed to start push session to %s: %v",
				o.session.UniqueKey(), destUrl, err)
			continue
		}

		// Monitor push session for errors
		go func(ps *rtmp.PushSession, url string) {
			err := <-ps.WaitChan()
			nazalog.Warnf("[%s] Push session to %s ended: %v",
				o.session.UniqueKey(), url, err)
		}(pushSession, destUrl)

		pushSessions = append(pushSessions, pushSession)
	}

	// Store push sessions for this stream
	o.rs.pushSessions[o.streamName] = pushSessions
}

func main() {
	_ = nazalog.Init(func(option *nazalog.Option) {
		option.AssertBehavior = nazalog.AssertFatal
	})
	defer nazalog.Sync()
	base.LogoutStartInfo()

	listen := flag.String("l", "0.0.0.0:1935", "specify RTMP listening address")
	o := flag.String("o", "", "specify push rtmp url list, separated by a comma")
	s := flag.String("s", "*", "specify stream name to relay (default: * for all streams)")
	flag.Parse()

	if *o == "" {
		flag.Usage()
		_, _ = fmt.Fprintf(os.Stderr, `Example:
  %s -l 0.0.0.0:1935 -o rtmp://dest1.example.com/live/stream,rtmp://dest2.example.com/live/stream
  %s -l 0.0.0.0:1935 -o rtmp://dest1.example.com/live/stream -s mystream
`, os.Args[0], os.Args[0])
		base.OsExitAndWaitPressIfWindows(1)
	}

	destUrls := strings.Split(*o, ",")
	for i := range destUrls {
		destUrls[i] = strings.TrimSpace(destUrls[i])
	}

	// Create and configure the relay server
	relay := NewRelayServer(*listen)

	// Add destination URLs for the specified stream
	relay.AddDestination(*s, destUrls)

	// Start the relay server
	nazalog.Infof("Starting RTMP relay server. Listening on %s, relaying to %d destinations", *listen, len(destUrls))
	err := relay.Start()
	if err != nil {
		nazalog.Errorf("Failed to start relay server: %v", err)
		base.OsExitAndWaitPressIfWindows(1)
	}

	// This is a blocking call, but adding a sleep to make sure everything shuts down cleanly
	time.Sleep(1 * time.Second)
}
