/**
 * P0 验证脚本 Part 2：
 * 1. splitReportFile 的参数签名
 * 2. agent 实例运行时属性（通过创建真实实例）
 * 3. reportFileToMarkdown / reportToMarkdown 签名
 */

import 'dotenv/config';

// ====== 验证 splitReportFile 签名 ======
console.log('\n=== 验证 splitReportFile 参数签名 ===\n');

import { splitReportFile, reportFileToMarkdown, reportToMarkdown, splitReportHtmlByExecution } from '@midscene/core';

console.log('splitReportFile.length (参数个数):', splitReportFile.length);
console.log('splitReportFile.toString() 前200字符:\n', splitReportFile.toString().substring(0, 500));

console.log('\n--- reportFileToMarkdown ---');
console.log('参数个数:', reportFileToMarkdown.length);
console.log('前300字符:\n', reportFileToMarkdown.toString().substring(0, 300));

console.log('\n--- reportToMarkdown ---');
console.log('参数个数:', reportToMarkdown.length);
console.log('前300字符:\n', reportToMarkdown.toString().substring(0, 300));

console.log('\n--- splitReportHtmlByExecution ---');
console.log('参数个数:', splitReportHtmlByExecution.length);
console.log('前300字符:\n', splitReportHtmlByExecution.toString().substring(0, 300));

// ====== 尝试用已有报告测试 splitReportFile ======
console.log('\n=== 用已有报告测试 splitReportFile ===\n');

import fs from 'fs';
import path from 'path';

const reportDir = path.resolve('midscene_run/report');
if (fs.existsSync(reportDir)) {
  const htmlFiles = fs.readdirSync(reportDir).filter(f => f.endsWith('.html'));
  console.log('找到报告文件:', htmlFiles);
  
  if (htmlFiles.length > 0) {
    const testFile = path.join(reportDir, htmlFiles[0]);
    console.log('\n尝试解析:', testFile);
    
    try {
      const result = splitReportFile(testFile);
      console.log('✅ splitReportFile 调用成功！');
      console.log('返回值类型:', typeof result);
      console.log('返回值 keys:', Object.keys(result));
      console.log('返回值:', JSON.stringify(result, null, 2).substring(0, 1000));
    } catch (e) {
      console.log('❌ splitReportFile 调用失败:', (e as Error).message);
      
      // 尝试其他参数形式
      try {
        const result2 = splitReportFile({ htmlPath: testFile, outputDir: reportDir } as any);
        console.log('✅ splitReportFile({htmlPath, outputDir}) 调用成功！');
        console.log('返回值:', JSON.stringify(result2, null, 2).substring(0, 1000));
      } catch (e2) {
        console.log('❌ splitReportFile({htmlPath, outputDir}) 也失败:', (e2 as Error).message);
      }
    }
  }
}

// ====== 验证 agent 实例的运行时属性 ======
console.log('\n=== 验证 PageAgent 基类属性 ===\n');

import { PageAgent } from '@midscene/web';

const pageAgentProto = Object.getOwnPropertyNames(PageAgent.prototype);
console.log('PageAgent.prototype 属性:', pageAgentProto);

const reportRelated = pageAgentProto.filter(k => /report|file|path|dump|log/i.test(k));
console.log('匹配 report/file/path/dump/log:', reportRelated.length > 0 ? reportRelated : '(无匹配)');

// 检查 Agent 基类（来自 @midscene/core）
import { Agent, createAgent } from '@midscene/core';
if (Agent) {
  const agentProto = Object.getOwnPropertyNames(Agent.prototype);
  console.log('\nAgent.prototype (core) 属性:', agentProto);
  const agentReportRelated = agentProto.filter(k => /report|file|path|dump|log/i.test(k));
  console.log('匹配 report/file/path/dump/log:', agentReportRelated.length > 0 ? agentReportRelated : '(无匹配)');
}

console.log('\n=== P0 验证完成 ===\n');
