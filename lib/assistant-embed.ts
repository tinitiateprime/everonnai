import { createHash } from "node:crypto";
import { load } from "cheerio";
import { PREVIEW_CSP } from "./validation";

export function assistantFramePath(
  business: string,
  version: string,
  revision: string,
) {
  return `/assistant/${encodeURIComponent(business)}/${version}?revision=${encodeURIComponent(revision)}`;
}
export function attachAssistant(
  html: string,
  business: string,
  version: string,
  revision: string,
) {
  const framePath = assistantFramePath(business, version, revision);
  const script = `(()=>{const frame=document.createElement('iframe');frame.src=${JSON.stringify(framePath)};frame.title='Business voice and chat assistant';frame.allow='microphone; autoplay';frame.referrerPolicy='strict-origin-when-cross-origin';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms');let open=false;Object.assign(frame.style,{position:'fixed',right:'16px',bottom:'16px',border:'0',background:'transparent',zIndex:'2147483647',colorScheme:'normal'});const resize=()=>{frame.style.width=Math.min(open?420:244,innerWidth-24)+'px';frame.style.height=Math.min(open?620:76,innerHeight-24)+'px'};addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='everonn-assistant-size')return;open=event.data.open===true;resize()});addEventListener('resize',resize);document.body.appendChild(frame);resize()})();`;
  const hash = createHash("sha256").update(script).digest("base64");
  const csp = PREVIEW_CSP.replace(
    "script-src 'none'",
    `script-src 'sha256-${hash}'`,
  ).replace("frame-src 'none'", "frame-src 'self'");
  const $ = load(html);
  $("meta[http-equiv='Content-Security-Policy']").remove();
  // Only this application-authored script is allowed; model-authored scripts remain blocked.
  $("body").append(`<script>${script}</script>`);
  return { html: $.html(), csp };
}
