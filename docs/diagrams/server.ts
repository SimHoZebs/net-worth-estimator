const dir = new URL(".", import.meta.url).pathname;

const hostname = process.env.HOST ?? "127.0.0.1";

const server = Bun.serve({
  port: 8131,
  hostname,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/index.html";
    const file = Bun.file(dir + path);
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    const type = path.endsWith(".html")
      ? "text/html; charset=utf-8"
      : path.endsWith(".svg")
        ? "image/svg+xml"
        : path.endsWith(".mmd")
          ? "text/plain; charset=utf-8"
          : "application/octet-stream";
    return new Response(file, { headers: { "Content-Type": type } });
  },
});

console.log(`unified-projection diagrams at http://127.0.0.1:${server.port}/`);
