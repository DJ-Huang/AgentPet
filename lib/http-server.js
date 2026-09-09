"use strict";

const http = require("node:http");

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function createStateServer({ host, port, machine, ensurePet }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      sendJson(res, 200, { ok: true, state: machine.aggregate() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/state") {
      sendJson(res, 200, machine.snapshot());
      return;
    }

    if (req.method === "POST" && url.pathname === "/reset") {
      sendJson(res, 200, { ok: true, ...machine.reset() });
      return;
    }

    if (req.method === "POST" && (url.pathname === "/state" || url.pathname === "/ensure")) {
      let payload = {};
      try {
        const raw = await readBody(req);
        payload = raw ? JSON.parse(raw) : {};
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error.message || error) });
        return;
      }

      if (url.pathname === "/ensure" && typeof ensurePet === "function") {
        ensurePet();
      }

      const snapshot = machine.apply({
        sessionId: payload.session_id || payload.sessionId,
        state: payload.state,
        source: payload.source || "hook",
        event: payload.event,
        payload: payload.payload || payload,
      });
      sendJson(res, 200, { ok: true, ...snapshot });
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.on("error", (error) => {
        console.error("[http]", error);
      });
      resolve(server);
    });
  });
}

module.exports = { createStateServer };
