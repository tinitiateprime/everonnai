import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  symlink,
  unlink,
  rm,
} from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { PlatformError } from "../platform/config";
import type { Design } from "./design";
export type SiteContent = {
  business: Record<string, string>;
  pages: {
    id: string;
    path: string;
    title: string;
    family: string;
    text: string;
    headings: string[];
  }[];
  redirects: { path: string; target: string }[];
  basePath: string;
  enquiryEndpoint: string;
};
export type CompiledSite = {
  source: Map<string, Uint8Array>;
  output: Map<string, Uint8Array>;
  nextVersion: string;
  dependencyLockSha256: string;
};
const safeEnv = () =>
  Object.fromEntries(
    [
      "PATH",
      "Path",
      "SYSTEMROOT",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "USERPROFILE",
      "HOME",
      "COMSPEC",
      "ComSpec",
    ].flatMap((name) =>
      process.env[name] ? [[name, process.env[name]!]] : [],
    ),
  );
const enquiryCode = `'use client';
import {useRef,useState} from 'react';
export default function Enquiry({endpoint}){const [state,setState]=useState(''),[busy,setBusy]=useState(false);const key=useRef(null);return <section className="enquiry"><h2>Send an enquiry</h2><p>This preview saves enquiries to the project inbox. Email delivery and production publishing are configured separately.</p><form aria-label="Enquiry form" aria-busy={busy} onSubmit={async event=>{event.preventDefault();setBusy(true);setState('');const form=event.currentTarget;const data=new FormData(form);const payload={name:data.get('name'),email:data.get('email'),message:data.get('message')};const signature=JSON.stringify(payload);if(key.current?.signature!==signature)key.current={signature,value:crypto.randomUUID()};try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestKey:key.current.value,...payload})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save your enquiry.');setState('Your enquiry was saved to the project inbox.');key.current=null;form.reset();}catch(error){setState(error.message);}finally{setBusy(false);}}}><label>Your name<input name="name" disabled={busy} required maxLength={120}/></label><label>Email address<input name="email" disabled={busy} type="email" required maxLength={320}/></label><label>Your message<textarea name="message" disabled={busy} required minLength={5} maxLength={5000}/></label><button disabled={busy} type="submit">{busy?'Saving…':'Submit enquiry'}</button><p role="status">{state}</p></form></section>}`;
export const baseCss = `.skip-link{position:absolute;top:8px;left:8px;transform:translateY(-200%);z-index:100}.skip-link:focus{transform:none;background:white;color:#172323;padding:12px}.page-directory ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px;padding:0;list-style:none}.page-directory a{display:block;padding:12px}*{box-sizing:border-box}body{margin:0;line-height:1.6}a{color:inherit}img{max-width:100%}.site-shell{min-width:0}.site-header,.site-nav{display:flex;align-items:center;flex-wrap:wrap;gap:16px}.site-header{justify-content:space-between}.brand{font-size:1.3rem;font-weight:700}.site-nav a{padding:8px}.hero-title{font-size:clamp(2rem,5vw,4rem);line-height:1.15;overflow-wrap:anywhere}.hero.center{text-align:center}.source-content{overflow-wrap:anywhere}.source-paragraph{margin:0 0 1.5rem}.business-facts{display:flex;flex-wrap:wrap;gap:24px;margin:32px 0}.enquiry{margin:40px 0}.enquiry form{max-width:650px}.enquiry label{display:grid;gap:8px;margin:16px 0}.enquiry input,.enquiry textarea{font:inherit;padding:12px;width:100%;border:1px solid currentColor;border-radius:4px;background:white;color:#172323}.enquiry textarea{min-height:130px}.enquiry button{font:inherit;cursor:pointer}.site-footer{border-top:1px solid currentColor;padding:24px 0}.site-nav{max-width:100%}:focus-visible{outline:3px solid currentColor;outline-offset:3px}.layout-rail{display:grid;grid-template-columns:240px minmax(0,1fr);gap:32px}.layout-rail .site-header{display:block}.layout-rail .site-nav{flex-direction:column;align-items:flex-start}.hero.split{display:grid;grid-template-columns:2fr 1fr;gap:24px}.content-columns .source-content{column-count:2;column-gap:32px}.content-cards .source-paragraph{padding:20px;border:1px solid currentColor;border-radius:8px}@media(max-width:700px){.layout-rail,.hero.split{display:block}.layout-rail .site-nav{flex-direction:row}.content-columns .source-content{column-count:1}}`;
export async function generateSource(
  content: SiteContent,
  design: Design,
  inputs: unknown,
) {
  const root = process.cwd();
  const versions = await Promise.all(
    ["next", "react", "react-dom"].map(async (name) => [
      name,
      JSON.parse(
        await readFile(
          path.join(root, "node_modules", name, "package.json"),
          "utf8",
        ),
      ).version,
    ]),
  );
  const dependencies = Object.fromEntries(versions);
  const packageJson = {
    name: "everonn-generated-website",
    version: "1.0.0",
    private: true,
    scripts: { build: "next build --webpack", dev: "next dev" },
    dependencies,
  };
  const lock = JSON.parse(
    await readFile(path.join(root, "package-lock.json"), "utf8"),
  );
  lock.name = packageJson.name;
  lock.version = "1.0.0";
  lock.packages[""] = {
    name: packageJson.name,
    version: "1.0.0",
    dependencies,
  };
  const siteCode = `import data from '../content/site.json';import design from '../content/design.json';import Enquiry from './enquiry';
const href=path=>data.basePath+(path==='/'?'/':path+'/');
const primary=data.pages.filter(item=>item.path==='/'||['about','service','contact'].includes(item.family)).slice(0,6);
const labels={email:'Email',phone:'Phone',address:'Address',hours:'Opening hours'};
export function Site({page}){
const chunks=[];let chunk='';for(const word of page.text.split(' ')){if(chunk&&chunk.length+word.length>1000){chunks.push(chunk);chunk=word;}else{chunk+=(chunk?' ':'')+word;}}if(chunk)chunks.push(chunk);
const details=Object.entries(data.business).filter(([key])=>key!=='business_name');
return <div className={'site-shell layout-'+design.navigation+' content-'+design.content}>
<a className="skip-link" href="#main-content">Skip to main content</a>
<header className="site-header"><a className="brand" href={href('/')}>{data.business.business_name}</a><nav className="site-nav" aria-label="Website navigation">{primary.map(item=><a key={item.path} aria-current={page.path===item.path?'page':undefined} href={href(item.path)}>{item.title}</a>)}</nav></header>
<div><main id="main-content" tabIndex={-1}><section className={'hero '+design.hero}><div className="hero-copy"><h1 className="hero-title">{page.title}</h1><p>{data.business.business_name}</p></div>{design.hero==='split'&&<div className="business-facts">{details.map(([key,value])=><p key={key}>{value}</p>)}</div>}</section>
<article className={'page-body family-'+page.family}><div className="page-headings">{page.headings.slice(0,4).map((heading,index)=><h2 key={index}>{heading}</h2>)}</div><div className="source-content" data-source-content>{chunks.map((text,index)=><p className="source-paragraph" key={index}>{text}</p>)}</div></article>
<aside className="business-facts" aria-label="Approved business details">{details.map(([key,value])=><p key={key} data-fact-key={key}><strong>{labels[key]||key}: </strong><span data-fact-value>{value}</span></p>)}</aside>
{page.path==='/'&&<section className="page-directory"><h2>Explore our website</h2><nav aria-label="All website pages"><ul>{data.pages.map(item=><li key={item.path}><a href={href(item.path)}>{item.title}</a></li>)}</ul></nav></section>}
{(page.path==='/'||page.family==='contact')&&<Enquiry endpoint={data.enquiryEndpoint}/>}</main><footer className="site-footer">{data.business.business_name}</footer></div></div>;}
`;
  const files: Record<string, string> = {
    "package.json": JSON.stringify(packageJson, null, 2),
    "package-lock.json": JSON.stringify(lock, null, 2),
    "next.config.mjs": `export default {output:'export',trailingSlash:true,basePath:${JSON.stringify(content.basePath)},poweredByHeader:false,experimental:{cpus:2}};`,
    "app/layout.jsx": `import './globals.css';export const metadata={title:${JSON.stringify(content.business.business_name)},robots:{index:false,follow:false}};export default function Layout({children}){return <html lang="en"><body>{children}</body></html>;}`,
    "app/page.jsx": `import data from '../content/site.json';import {Site} from '../components/site';export const metadata={title:data.pages.find(page=>page.path==='/').title,robots:{index:false,follow:false}};export default function Home(){return <Site page={data.pages.find(page=>page.path==='/')}/>;}`,
    "app/[...segments]/page.jsx": `import data from '../../content/site.json';import {Site} from '../../components/site';import {notFound} from 'next/navigation';export const dynamicParams=false;export function generateStaticParams(){return [...data.pages.filter(page=>page.path!=='/'),...data.redirects].map(page=>({segments:page.path.slice(1).split('/')}));}export async function generateMetadata({params}){const {segments}=await params;const page=data.pages.find(page=>page.path==='/'+segments.join('/'));return {title:page?.title||'Redirect',robots:{index:false,follow:false}};}export default async function Page({params}){const {segments}=await params;const path='/'+segments.join('/');const page=data.pages.find(page=>page.path===path);const target=data.redirects.find(page=>page.path===path)?.target;if(target)return <main><h1>Page moved</h1><a href={data.basePath+(target==='/'?'/':target+'/')}>Continue to this page</a></main>;if(!page)notFound();return <Site page={page}/>;}`,
    "app/not-found.jsx": `export default function NotFound(){return <main><h1>Page not found</h1></main>;}`,
    "app/globals.css": baseCss + "\n" + design.css,
    "components/site.jsx": siteCode,
    "components/enquiry.jsx": enquiryCode,
    "content/site.json": JSON.stringify(content),
    "content/design.json": JSON.stringify(design),
    "contracts/build-inputs.json": JSON.stringify(inputs, null, 2),
    "contracts/feature-contracts.json": JSON.stringify(
      {
        enquiry: {
          version: "1.0.0",
          mode: "preview_local",
          endpoint: content.enquiryEndpoint,
          requires:
            "Authenticated project editor session; project inbox backend. External email/production deployment are separate.",
        },
      },
      null,
      2,
    ),
    "README.md":
      "Generated Next.js application. Run npm ci, then npm run build. This artifact uses its fixed private preview base path and enquiry gateway; standalone publication needs a separate hosting/gateway binding. No credentials are included. Full-document internal navigation keeps the build fixed.\n",
  };
  if (
    content.pages.every((page) => page.path === "/") &&
    !content.redirects.length
  )
    delete files["app/[...segments]/page.jsx"];
  return {
    files: new Map(
      Object.entries(files).map(([name, value]) => [name, Buffer.from(value)]),
    ),
    nextVersion: dependencies.next as string,
  };
}
async function cleanupWorkspace(workspace: string, linked: boolean) {
  const resolved = path.resolve(workspace);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith("everonn-next-build-")
  )
    throw new Error("Unsafe compiler cleanup path");
  const link = path.join(resolved, "node_modules");
  if (linked && (await lstat(link)).isSymbolicLink()) await unlink(link);
  await rm(resolved, { recursive: true, force: true });
}
export async function compileSite(
  source: Map<string, Uint8Array>,
  signal?: AbortSignal,
): Promise<Map<string, Uint8Array>> {
  const workspace = await mkdtemp(
    path.join(os.tmpdir(), "everonn-next-build-"),
  );
  let linked = false;
  try {
    for (const [name, bytes] of source) {
      const target = path.join(workspace, ...name.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    await symlink(
      path.join(process.cwd(), "node_modules"),
      path.join(workspace, "node_modules"),
      "junction",
    );
    linked = true;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.join(process.cwd(), "node_modules/next/dist/bin/next"),
          "build",
          "--webpack",
        ],
        {
          cwd: workspace,
          windowsHide: true,
          env: {
            ...safeEnv(),
            NODE_ENV: "production",
            NEXT_TELEMETRY_DISABLED: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (data) => {
        output = (output + data).slice(-12000);
      });
      child.stderr.on("data", (data) => {
        output = (output + data).slice(-12000);
      });
      const stop = () => {
        if (child.pid && child.exitCode === null) {
          if (process.platform === "win32")
            execFile(
              "taskkill",
              ["/pid", String(child.pid), "/T", "/F"],
              { windowsHide: true },
              () => {},
            );
          else child.kill("SIGKILL");
        }
      };
      const timer = setTimeout(stop, 180_000);
      signal?.addEventListener("abort", stop, { once: true });
      if (signal?.aborted) stop();
      child.once("error", (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        if (code === 0) resolve();
        else {
          const kind = /Module not found|Can't resolve/i.test(output)
            ? "dependency resolution"
            : /Unexpected token|SyntaxError/i.test(output)
              ? "source compilation"
              : "Next.js export";
          reject(
            new PlatformError(
              `Generated website failed ${kind}. Retry or create a new build.`,
              503,
            ),
          );
        }
      });
    });
    const output = new Map<string, Uint8Array>();
    let size = 0;
    async function walk(directory: string, prefix = "") {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
          throw new PlatformError("Unexpected output link.", 503);
        const name = prefix + entry.name;
        if (entry.isDirectory())
          await walk(path.join(directory, entry.name), name + "/");
        else {
          const bytes = await readFile(path.join(directory, entry.name));
          size += bytes.byteLength;
          if (size > 64_000_000)
            throw new PlatformError(
              "The compiled output exceeds the disclosed 64 MB artifact limit.",
              413,
            );
          output.set(name, bytes);
        }
      }
    }
    await walk(path.join(workspace, "out"));
    return output;
  } finally {
    await cleanupWorkspace(workspace, linked);
  }
}
