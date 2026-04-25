/**
 * P0 验证脚本：确认 Phase 1 核心链路依赖的 API 是否存在
 * 
 * 验证项：
 * 1. agent.reportFile 属性是否存在
 * 2. splitReportFile 的导入路径和参数签名
 */

import 'dotenv/config';

// ====== 验证 1: splitReportFile 导入路径 ======
console.log('\n=== 验证 splitReportFile 导入路径 ===\n');

// 尝试从 @midscene/core 导入
try {
  const core = await import('@midscene/core');
  const coreKeys = Object.keys(core).filter(k => /report|split|parse/i.test(k));
  console.log('✅ @midscene/core 导入成功');
  console.log('   匹配 report/split/parse 的导出:', coreKeys.length > 0 ? coreKeys : '(无匹配)');
  if (core.splitReportFile) {
    console.log('   ✅ splitReportFile 存在于 @midscene/core');
    console.log('   类型:', typeof core.splitReportFile);
  } else {
    console.log('   ❌ splitReportFile 不在 @midscene/core');
  }
} catch (e) {
  console.log('❌ @midscene/core 导入失败:', (e as Error).message);
}

// 尝试从 @midscene/web 导入
try {
  const web = await import('@midscene/web');
  const webKeys = Object.keys(web).filter(k => /report|split|parse/i.test(k));
  console.log('\n✅ @midscene/web 导入成功');
  console.log('   匹配 report/split/parse 的导出:', webKeys.length > 0 ? webKeys : '(无匹配)');
  if ((web as any).splitReportFile) {
    console.log('   ✅ splitReportFile 存在于 @midscene/web');
  }
} catch (e) {
  console.log('❌ @midscene/web 导入失败:', (e as Error).message);
}

// 尝试从 @midscene/web/playwright 导入
try {
  const pw = await import('@midscene/web/playwright');
  const pwKeys = Object.keys(pw).filter(k => /report|split|parse/i.test(k));
  console.log('\n✅ @midscene/web/playwright 导入成功');
  console.log('   匹配 report/split/parse 的导出:', pwKeys.length > 0 ? pwKeys : '(无匹配)');
  if ((pw as any).splitReportFile) {
    console.log('   ✅ splitReportFile 存在于 @midscene/web/playwright');
  }
} catch (e) {
  console.log('❌ @midscene/web/playwright 导入失败:', (e as Error).message);
}

// 扫描所有 @midscene 包的导出
console.log('\n=== 扫描所有 @midscene 包导出 ===\n');

const packagesToScan = [
  '@midscene/core',
  '@midscene/core/utils',
  '@midscene/web',
  '@midscene/web/playwright',
  '@midscene/web/utils',
];

for (const pkg of packagesToScan) {
  try {
    const mod = await import(pkg);
    const allKeys = Object.keys(mod);
    console.log(`📦 ${pkg}: [${allKeys.join(', ')}]`);
  } catch {
    console.log(`📦 ${pkg}: (导入失败)`);
  }
}

// ====== 验证 2: PlaywrightAgent 实例属性 ======
console.log('\n=== 验证 PlaywrightAgent 实例属性 ===\n');

try {
  const { PlaywrightAgent } = await import('@midscene/web/playwright');
  
  // 检查原型上的方法和属性
  const proto = PlaywrightAgent.prototype;
  const protoKeys = Object.getOwnPropertyNames(proto);
  console.log('PlaywrightAgent.prototype 属性:', protoKeys);
  
  const reportRelated = protoKeys.filter(k => /report|file|path|dump|log/i.test(k));
  console.log('匹配 report/file/path/dump/log 的属性:', reportRelated.length > 0 ? reportRelated : '(无匹配)');

  // 检查静态方法
  const staticKeys = Object.getOwnPropertyNames(PlaywrightAgent);
  const staticReportRelated = staticKeys.filter(k => /report|split|parse/i.test(k));
  console.log('PlaywrightAgent 静态属性:', staticKeys);
  console.log('匹配 report/split/parse 的静态属性:', staticReportRelated.length > 0 ? staticReportRelated : '(无匹配)');
  
} catch (e) {
  console.log('❌ PlaywrightAgent 检查失败:', (e as Error).message);
}

console.log('\n=== 验证完成 ===\n');
