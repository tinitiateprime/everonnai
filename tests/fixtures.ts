import { emptyKnowledge, type Knowledge, type Model } from "../lib/types";
export const brief: Knowledge = {
  ...emptyKnowledge,
  description:
    "Northline provides residential heating and cooling installation, seasonal maintenance and urgent repairs. The team helps homeowners choose the right equipment, explains available options clearly and leaves each workspace clean. Services are available throughout the city. Comfort and thoughtful customer communication guide every visit.",
  businessName: "Northline",
  businessType: "Residential heating and cooling",
  phone: "+1 212 555 0124",
  email: "hello@northline.example",
  services: [
    {
      name: "AC installation",
      description: "Sizing and installation for residential homes.",
    },
  ],
};
// Test-only model output; never imported by runtime code or used as a generation fallback.
export function website(name = "Northline") {
  const css =
    "body{margin:0;color:#233524;background:#fafbf4;font-family:Arial,sans-serif}main{max-width:1100px;margin:auto;padding:40px 24px}h1{font-size:clamp(32px,7vw,84px);line-height:1.1}p{line-height:1.8;max-width:65ch}section{padding:40px 0}nav{display:flex;flex-wrap:wrap;gap:20px}a{color:#314d27}a:focus-visible{outline:3px solid #78934b}details{border-top:1px solid #c5d1b3;padding:18px}summary{cursor:pointer}footer{padding:40px;background:#e3ebd7}button{font:inherit}*{box-sizing:border-box}img{max-width:100%;height:auto}h2{font-size:36px}header{padding:24px}ul{padding-left:20px}li{line-height:1.8;margin-bottom:8px}.accent{color:#5b7d40}.label{letter-spacing:2px;text-transform:uppercase;font-size:12px}.content{display:grid;gap:24px}.note{padding:24px;border:1px solid #d1dcc4;border-radius:12px}@media(max-width:600px){main{padding:24px 18px}h2{font-size:28px}header{padding:18px}section{padding:24px 0}}";
  return `<!DOCTYPE html><html lang="en"><head><title>${name} Heating &amp; Cooling</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Residential heating and cooling services"><style>${css}</style></head><body><header><nav><a href="#services">Services</a><a href="#contact">Contact</a></nav></header><main><h1>${name}: comfort at home</h1><p>${brief.description}</p><section id="services"><h2>AC installation</h2><p>Sizing and installation for residential homes. Our team explains your equipment options and considers the needs of your home before installation. Seasonal maintenance and urgent repairs keep your home comfortable when you need it.</p></section><section id="contact"><h2>Speak with our team</h2><a href="tel:+12125550124">+1 212 555 0124</a><a href="mailto:hello@northline.example">hello@northline.example</a></section></main><footer>Northline heating and cooling services.</footer></body></html>`;
}
export const model: Model = {
  id: "test/coder:free",
  name: "Test coding model",
  context_length: 262144,
  description: "Coding and software generation",
  supported_parameters: ["response_format", "temperature"],
  top_provider: { max_completion_tokens: 32000 },
  pricing: { prompt: "0", completion: "0" },
};
