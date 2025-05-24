package main

import (
	"log"
	"net/url"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/widget"
	"github.com/q191201771/lal/pkg/base"
	"github.com/q191201771/naza/pkg/nazalog"

	"liveagent"
)

const (
	// Preference keys
	prefServer1Address = "server1Address"
	prefServer1Key     = "server1Key"
	prefServer2Address = "server2Address"
	prefServer2Key     = "server2Key"
)

func main() {
	myApp := app.New()
	myWindow := myApp.NewWindow("Stream Configuration")

	// Get the application preferences
	prefs := myApp.Preferences()

	// Create form 1: Primary Server
	serverEntry1 := widget.NewEntry()
	serverEntry1.SetText(prefs.String(prefServer1Address))
	serverEntry1.SetPlaceHolder("rtmp://example.com/live")
	serverEntry1.OnChanged = func(text string) {
		prefs.SetString(prefServer1Address, text)
		log.Println("Server 1 address saved:", text)
	}

	streamKeyEntry1 := widget.NewEntry()
	streamKeyEntry1.SetText(prefs.String(prefServer1Key))
	streamKeyEntry1.SetPlaceHolder("your-stream-key")
	streamKeyEntry1.Password = true // Hide the stream key for security
	streamKeyEntry1.OnChanged = func(text string) {
		prefs.SetString(prefServer1Key, text)
		log.Println("Server 1 stream key saved")
	}

	form1 := &widget.Form{
		Items: []*widget.FormItem{
			{Text: "Server Address", Widget: serverEntry1, HintText: "RTMP URL for primary server"},
			{Text: "Stream Key", Widget: streamKeyEntry1, HintText: "Stream key for primary server"},
		},
	}

	// Create form 2: Secondary Server
	serverEntry2 := widget.NewEntry()
	serverEntry2.SetText(prefs.String(prefServer2Address))
	serverEntry2.SetPlaceHolder("rtmp://backup.example.com/live")
	serverEntry2.OnChanged = func(text string) {
		prefs.SetString(prefServer2Address, text)
		log.Println("Server 2 address saved:", text)
	}

	streamKeyEntry2 := widget.NewEntry()
	streamKeyEntry2.SetText(prefs.String(prefServer2Key))
	streamKeyEntry2.SetPlaceHolder("your-backup-stream-key")
	streamKeyEntry2.Password = true // Hide the stream key for security
	streamKeyEntry2.OnChanged = func(text string) {
		prefs.SetString(prefServer2Key, text)
		log.Println("Server 2 stream key saved")
	}

	form2 := &widget.Form{
		Items: []*widget.FormItem{
			{Text: "Server Address", Widget: serverEntry2, HintText: "RTMP URL for secondary server"},
			{Text: "Stream Key", Widget: streamKeyEntry2, HintText: "Stream key for secondary server"},
		},
	}

	// Create labels for the forms
	form1Label := widget.NewLabel("1号服务器")
	form1Label.TextStyle = fyne.TextStyle{Bold: true}

	form2Label := widget.NewLabel("2号服务器")
	form2Label.TextStyle = fyne.TextStyle{Bold: true}

	// Create a card for form 1
	form1Container := container.NewVBox(
		form1Label,
		form1,
	)

	// Create a card for form 2
	form2Container := container.NewVBox(
		form2Label,
		form2,
	)

	// Layout everything in a vertical box
	content := container.NewVBox(
		form1Container,
		widget.NewSeparator(),
		form2Container,
		widget.NewSeparator(),
		widget.NewButton("开启转播器", func() {

			go func() {
				localhost := "0.0.0.0:1935"
				// Create and configure the relay server
				relay := liveagent.NewRelayServer(localhost)

				dest1 := buildRtmpURL(prefs.String(prefServer1Address), prefs.String(prefServer1Key))
				dest2 := buildRtmpURL(prefs.String(prefServer2Address), prefs.String(prefServer2Key))

				dests := []string{}
				if dest1 != "" {
					dests = append(dests, dest1)
				}
				if dest2 != "" {
					dests = append(dests, dest2)
				}
				nazalog.Debug(dests)
				if len(dests) == 0 {
					nazalog.Error("no dests")
					return
				}

				// Add destination URLs for the specified stream
				// has to be *
				relay.AddDestination("*", dests)

				// Start the relay server
				nazalog.Infof("Starting RTMP relay server. Listening on %s, relaying to %d destinations", localhost, 2)
				err := relay.Start()
				if err != nil {
					nazalog.Errorf("Failed to start relay server: %v", err)
					base.OsExitAndWaitPressIfWindows(1)
				}
			}()

		}),
	)

	myWindow.SetContent(content)
	myWindow.Resize(fyne.NewSize(800, 600))
	myWindow.ShowAndRun()
}

func buildRtmpURL(host, streamKey string) string {
	u, err := url.Parse(host)
	if err != nil {
		panic(err)
	}
	return u.JoinPath(streamKey).String()
}
