import config from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
const rules = [...config, ...typescript, { ignores: [".next/**", "next-env.d.ts"] }];
export default rules;
