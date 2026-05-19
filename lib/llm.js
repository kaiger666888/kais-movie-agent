/**
 * 通用 LLM 调用工具
 *
 * 已迁移到 Hermes 适配器路由。
 * 此文件保留作为 re-export，确保现有 import 不中断。
 * 新代码应直接 import from './hermes-adapter.js'
 */

export { callLLM, callLLMJson } from './hermes-adapter.js';
