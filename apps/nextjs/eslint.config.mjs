import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// eslint-config-next v16 expose directement des flat configs.
const eslintConfig = [...coreWebVitals, ...typescript];

export default eslintConfig;
