/*
** A minimal EventSource over Node's http, for the partition harness.
**
** The point is that the stream crosses REAL sockets through the proxy, so
** sever() genuinely breaks it mid-stream — an injected fake could not die
** the way a socket dies. Reconnection retries on a short real timer (the
** library's silence alarm runs on the INJECTED clock, so real retry timing
** never races the test).
**
** Law 7 note: chunks are decoded with setEncoding("utf8"), which uses
** Node's StringDecoder — a chunk boundary inside a multibyte character is
** held, not replaced. Never emit text that has not survived a byte-exact
** decode.
*/
const http = require("http");

class NodeEventSource {
    constructor(url) {
        this.url = url;
        this.listeners = {};
        this.closed = false;
        this.connect();
    }
    addEventListener(name, fn) {
        (this.listeners[name] = this.listeners[name] || []).push(fn);
    }
    emit(name, ev) {
        (this.listeners[name] || []).forEach((fn) => { try { fn(ev); } catch (e) {} });
    }
    connect() {
        const req = http.get(this.url, (res) => {
            if (res.statusCode !== 200) { res.resume(); this.fail(); return; }
            this.emit("open", {});
            let buf = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
                buf += chunk;
                let i;
                while ((i = buf.indexOf("\n\n")) >= 0) {
                    this.dispatch(buf.slice(0, i));
                    buf = buf.slice(i + 2);
                }
            });
            res.on("end", () => this.fail());
            res.on("error", () => this.fail());
        });
        req.on("error", () => this.fail());
        this.req = req;
    }
    dispatch(block) {
        let ev = "message";
        const data = [];
        block.split("\n").forEach((line) => {
            if (line.indexOf("event:") === 0) { ev = line.slice(6).trim(); }
            else if (line.indexOf("data:") === 0) { data.push(line.slice(5).trim()); }
        });
        if (data.length) { this.emit(ev, { data: data.join("\n") }); }
    }
    fail() {
        if (this.closed || this.failing) { return; }
        this.failing = true;
        this.emit("error", {});
        setTimeout(() => {
            this.failing = false;
            if (!this.closed) { this.connect(); }
        }, 60);
    }
    close() {
        this.closed = true;
        if (this.req) { this.req.destroy(); }
    }
}

module.exports = NodeEventSource;
