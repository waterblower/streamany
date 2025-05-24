// Copyright 2023, Modified version of pullrtmp2pushrtmp
// https://github.com/q191201771/lal
//
// Use of this source code is governed by a MIT-style license
// that can be found in the License file.

package main

import (
	"flag"
	"fmt"
	"liveagent"
	"os"
	"strings"
	"time"

	"github.com/q191201771/lal/pkg/base"
	"github.com/q191201771/naza/pkg/nazalog"
)

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
	relay := liveagent.NewRelayServer(*listen)

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
