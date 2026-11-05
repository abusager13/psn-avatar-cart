# Legacy: native macOS prototype (AppKit)

`macos-appkit/main.swift` is the first version of this tool: a single-file AppKit app with no
build system beyond `swiftc`.

```bash
cp ../desktop/resources/avatar-sku-index.tsv .
swiftc -O main.swift -o PSNCart
./PSNCart
```

It is kept for reference only. It is macOS-only, and it predates the `.edat` decoding and the
region hunt that the React Native build now has.
