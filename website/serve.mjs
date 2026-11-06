import http from "node:http";
import worker from "./dist/server/index.js";

const responses = new Map();
globalThis.caches = {default: {
  async match(key) { return responses.get(key.url)?.clone(); },
  async put(key, value) { responses.set(key.url, value); }
}};
const port = Number(process.env.PORT || 8000);
const origin = "http://127.0.0.1:" + port;
http.createServer(async (req, res) => {
  try {
    const result = await worker.fetch(new Request(new URL(req.url, origin), {method:req.method}),
      {}, {waitUntil: promise => promise.catch(console.error)});
    res.writeHead(result.status, Object.fromEntries(result.headers));
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error(error.message);
    res.writeHead(500);
    res.end("The local server could not serve this request.");
  }
}).listen(port,"127.0.0.1",() => console.log(origin + "/#predict"));
