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
