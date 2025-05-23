rtmp:
	deno run --allow-net core/rtmp.ts

test:
	./assets/ffmpeg-mac -loglevel trace -re -i assets/test2.mp4 \
	    -c copy -f flv rtmp://localhost:1935/live

build:
	deno compile \
		--allow-read --allow-write --allow-run --allow-ffi \
		--allow-env=HOME,PLUGIN_URL,DENO_DIR \
		--allow-net \
		--include assets/ffmpeg-mac \
		-o build/relay \
		core/relay.ts

run:
	deno run \
		--allow-read --allow-write --allow-run \
		--allow-env=HOME,PLUGIN_URL,DENO_DIR \
		--allow-ffi \
		--allow-net \
		core/relay.ts

build-cli:
	deno compile \
		--allow-read --allow-write --allow-run --allow-ffi \
		--allow-env=HOME,PLUGIN_URL,DENO_DIR \
		--allow-net \
		--include assets/ffmpeg-mac \
		-o build/streamany \
		entries/cli.ts

cli:
	deno run \
		--allow-read --allow-write --allow-run \
		--allow-env=HOME,PLUGIN_URL,DENO_DIR \
		--allow-ffi \
		--allow-net \
		entries/cli.ts

fresh:
	cd entries/fresh && deno task preview

gui:
	cd go-f/gui && fyne package --source-dir . \
		-os darwin --icon ./icon.png \
		--app-id app.blowater.liveagent

rungui:
	cd go-f/gui && go run main.go
