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
