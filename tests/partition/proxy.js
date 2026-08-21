/*
** The partition, as a socket fact — PARTITION-FOUNDATIONS.md §5, piece 1.
**
** The world talks to this proxy, never to the server. sever() closes the
** listener AND destroys every live socket, so in-flight requests die
** mid-body and SSE streams break — 15 August, on demand. heal() brings the
** listener back on the SAME port, so the world's URL never changes (the
** world under test must survive the server vanishing, not learn new
** addresses).
*/
const net = require("net");

module.exports = function proxy(targetPort, cb) {
    const sockets = new Set();
    let listener = null;
    let severed = false;
    let port = 0;

    function open(done) {
        listener = net.createServer((down) => {
            if (severed) { down.destroy(); return; }
            const up = net.connect(targetPort, "127.0.0.1");
            sockets.add(down); sockets.add(up);
            down.pipe(up); up.pipe(down);
            const drop = () => {
                sockets.delete(down); sockets.delete(up);
                down.destroy(); up.destroy();
            };
            down.on("error", drop); up.on("error", drop);
            down.on("close", drop); up.on("close", drop);
        });
        listener.listen(port, "127.0.0.1", () => {
            port = listener.address().port;
            if (done) { done(); }
        });
    }

    open(() => cb({
        port: () => port,
        sever: () => new Promise((resolve) => {
            severed = true;
            sockets.forEach((s) => s.destroy());
            sockets.clear();
            listener.close(() => resolve());
        }),
        heal: () => new Promise((resolve) => {
            severed = false;
            open(resolve);
        }),
        close: () => new Promise((resolve) => {
            severed = true;
            sockets.forEach((s) => s.destroy());
            listener.close(() => resolve());
        })
    }));
};
