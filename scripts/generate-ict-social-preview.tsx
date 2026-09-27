import React from "react";
import { writeFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "ICT Mentorship with Mark — Alpha Traders Academy & Exchange";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logo = await readFile(join(process.cwd(), "public/images/brand/alpha-traders-logo-192.png"));
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "54px 64px", background: "#080909", color: "#F5F2E9", border: "2px solid #A98224" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        {/* ImageResponse renders a native image inside its generated graphic. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/png;base64,${logo.toString("base64")}`} width={82} height={82} alt="" />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={{ fontSize: 29, color: "#DFC16E" }}>ALPHA TRADERS</span><span style={{ fontSize: 19, letterSpacing: 3 }}>ACADEMY & EXCHANGE</span></div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 42 }}><span style={{ fontSize: 76, fontWeight: 700 }}>ICT Mentorship</span><span style={{ fontSize: 52, color: "#DFC16E", marginTop: 4 }}>with Mark</span></div>
      <div style={{ display: "flex", fontSize: 27, marginTop: 30 }}>Study. Practise. Ask. Review.</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", borderTop: "1px solid #483A1C", paddingTop: 24, fontSize: 22, color: "#D6D4CC" }}><span>Hear Mark’s approach · 7:44</span><span>alphatraders.co.il</span></div>
    </div>, size,
  );
}

async function main() { const response = await Image(); await writeFile("public/images/brand/alpha-ict-mentorship-social.png", Buffer.from(await response.arrayBuffer())); }
main().catch(error => { console.error(error); process.exitCode = 1; });
