package api

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func isBackendPath(requestPath string) bool {
	return requestPath == "/v1" || strings.HasPrefix(requestPath, "/v1/") ||
		requestPath == "/healthz" || strings.HasPrefix(requestPath, "/healthz/") ||
		requestPath == "/docs" || strings.HasPrefix(requestPath, "/docs/") ||
		strings.HasPrefix(requestPath, "/openapi") ||
		requestPath == "/schemas" || strings.HasPrefix(requestPath, "/schemas/")
}

func cleanFrontendRequestPath(requestPath string) (string, bool) {
	if strings.ContainsRune(requestPath, '\x00') || strings.ContainsRune(requestPath, '\\') {
		return "", false
	}
	for _, segment := range strings.Split(requestPath, "/") {
		if segment == ".." {
			return "", false
		}
	}
	return path.Clean("/" + requestPath), true
}

func serveFrontendFile(root *os.Root, name string, writer http.ResponseWriter, request *http.Request) (bool, bool) {
	file, err := root.Open(name)
	if err != nil {
		return false, os.IsNotExist(err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return false, false
	}
	if info.IsDir() {
		return serveFrontendFile(root, path.Join(name, "index.html"), writer, request)
	}
	if !info.Mode().IsRegular() {
		return false, true
	}
	http.ServeContent(writer, request, path.Base(name), info.ModTime(), file)
	return true, true
}

// serveFrontendMissingPage serves the bundled 404 page with a 404 status.
// Unknown page routes show that page (which redirects back to the app)
// instead of silently serving the index. Missing assets keep the plain
// 404 below so bad asset URLs never return HTML.
func serveFrontendMissingPage(root *os.Root, writer http.ResponseWriter, request *http.Request) bool {
	file, err := root.Open("404.html")
	if err != nil {
		return false
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || info.IsDir() || !info.Mode().IsRegular() {
		return false
	}
	writer.WriteHeader(http.StatusNotFound)
	http.ServeContent(writer, request, "404.html", info.ModTime(), file)
	return true
}

func frontendHandler(frontendDir string) http.HandlerFunc {
	frontendDir = filepath.Clean(frontendDir)
	return func(writer http.ResponseWriter, request *http.Request) {
		if isBackendPath(request.URL.Path) || (request.Method != http.MethodGet && request.Method != http.MethodHead) {
			http.NotFound(writer, request)
			return
		}

		requestPath, ok := cleanFrontendRequestPath(request.URL.Path)
		if !ok {
			http.NotFound(writer, request)
			return
		}
		root, err := os.OpenRoot(frontendDir)
		if err != nil {
			http.NotFound(writer, request)
			return
		}
		defer root.Close()

		fileName := strings.TrimPrefix(requestPath, "/")
		if fileName == "" {
			fileName = "index.html"
		}
		served, missing := serveFrontendFile(root, fileName, writer, request)
		if served {
			return
		}
		if !missing {
			http.NotFound(writer, request)
			return
		}
		if path.Ext(requestPath) == "" && !strings.HasPrefix(requestPath, "/assets/") {
			if serveFrontendMissingPage(root, writer, request) {
				return
			}
		}
		http.NotFound(writer, request)
	}
}
