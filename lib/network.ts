import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import ipaddr from "ipaddr.js";

export function isPublicIp(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function parsePublicUrl(value: string, base?: string) {
  const url = new URL(value, base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error(
      "Use a public HTTP or HTTPS website URL on a standard port.",
    );
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    (!host.includes(".") && !isIP(host)) ||
    /(^|\.)(localhost|local|internal|test|invalid)$/i.test(host) ||
    (isIP(host) && !isPublicIp(host))
  )
    throw new Error("Private and local addresses cannot be crawled.");
  url.hash = "";
  return url;
}
export type WebResource = {
  url: string;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};
export async function safeResource(
  value: string,
  options: {
    signal?: AbortSignal;
    maxBytes?: number;
    origin?: string;
    redirects?: number;
  } = {},
): Promise<WebResource> {
  options.signal?.throwIfAborted();
  const url = parsePublicUrl(value);
  if (options.origin && url.origin !== options.origin)
    throw new Error("Redirect left the source website.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicIp(a.address)))
    throw new Error("Website resolves to a private or reserved address.");
  options.signal?.throwIfAborted();
  const selected = addresses.find((a) => a.family === 4) ?? addresses[0];
  const limit = options.maxBytes ?? 2_000_000;
  const resource = await new Promise<WebResource>((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: "GET",
        signal: options.signal,
        timeout: 15000,
        headers: {
          "User-Agent": "EverOnnWebsiteStudio/1.0",
          Accept: "text/html,application/xml,text/plain,*/*;q=0.8",
          "Accept-Encoding": "identity",
        },
        // Pin the validated address at connection time; preserve hostname for TLS/SNI.
        lookup: (_host, opts, callback) => {
          if (typeof opts === "object" && opts.all) callback(null, [selected]);
          else callback(null, selected.address, selected.family);
        },
      },
      (response) => {
        let size = 0;
        const parts: Buffer[] = [];
        response.on("data", (part: Buffer) => {
          size += part.length;
          if (size > limit)
            request.destroy(
              new Error("Source response exceeds the size limit."),
            );
          else parts.push(part);
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            let body = Buffer.concat(parts);
            const encoding = response.headers["content-encoding"];
            const decompressOptions = { maxOutputLength: limit };
            if (encoding === "gzip") body = gunzipSync(body, decompressOptions);
            if (encoding === "br")
              body = brotliDecompressSync(body, decompressOptions);
            if (encoding === "deflate")
              body = inflateSync(body, decompressOptions);
            resolve({
              url: url.href,
              status: response.statusCode ?? 0,
              headers: response.headers,
              body,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("Source website timed out.")),
    );
    request.on("error", reject);
    request.end();
  });
  if (
    [301, 302, 303, 307, 308].includes(resource.status) &&
    resource.headers.location
  ) {
    if ((options.redirects ?? 0) >= 5)
      throw new Error("Too many website redirects.");
    return safeResource(new URL(resource.headers.location, url).href, {
      ...options,
      redirects: (options.redirects ?? 0) + 1,
    });
  }
  return resource;
}
