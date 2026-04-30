// ESLint 9 flat config
// 文档：https://eslint.org/docs/latest/use/configure/configuration-files
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  // 全局忽略
  {
    ignores: ["dist/**", "node_modules/**", "data/**", "coverage/**"],
  },

  // JS 默认推荐
  js.configs.recommended,

  // TypeScript 推荐（不开 type-checked，提速）
  ...tseslint.configs.recommended,

  // 项目级别细节
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // 允许 _ 前缀的未使用参数（构造函数注入、类型签名等场景常见）
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // 允许有意为之的 void 语句（用作"显式忽略 promise"或抑制未使用变量）
      "no-void": ["error", { allowAsStatement: true }],
      // 我们的 spider 经常需要 console.log 调试用 logger 替代——禁掉裸 console
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // 关闭和 Prettier 冲突的规则——必须放最后
  prettier,
);
