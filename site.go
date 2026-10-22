// Package fanmade embeds the built website in the API server.
package fanmade

import (
	"embed"
	"io/fs"
)

//go:embed all:web/dist
var dist embed.FS

// Site returns nil in an API-only development checkout before pnpm build.
func Site() fs.FS {
	site, err := fs.Sub(dist, "web/dist")
	if err != nil {
		return nil
	}
	if _, err := fs.Stat(site, "index.html"); err != nil {
		return nil
	}
	return site
}
