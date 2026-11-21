# 贡献指南

[English](CONTRIBUTING.md) | 中文

感谢参与。本仓库规模很小，所以流程很短，但由 CI 强制执行。

## 基本原则

- **代码里一律用英文**：标识符、注释、文档注释、提交信息、测试名、日志文本、错误信息。只有面向用户的文档是双语的。
- **仓库里不允许出现凭据**：不要写真实的目录地址、绑定 DN、密码或哈希。测试夹具一律使用明显伪造的值。
- **行为变更必须带测试**：改了行为却没有测试的 pull request 不予合并。
- **一个 pull request 只做一件事**：把重构和功能放在同一分支，会让评审变难、历史变乱。
- **不 fork `dsh` 包**。只用已文档化的扩展点；扩展点缺失时，先开 issue。

## 分支

`main` 始终是可发布状态。工作在短生命周期分支上进行：

```
feat/<短横线简述>      新行为
fix/<短横线简述>       缺陷修复
docs/<短横线简述>      仅文档
refactor/<短横线简述>  无行为变更
chore/<短横线简述>     工具链、依赖、CI
```

请求评审前先 rebase 到 `main`；不要在分支上合并 `main` 来解冲突。

## 提交

[Conventional Commits](https://www.conventionalcommits.org/) 由 `commitlint` 强制：

```
<type>(<scope>): <祈使句摘要>

<可选正文：说明为什么，而不是做了什么>

<可选脚注：BREAKING CHANGE: ...>
```

- 类型：`feat`、`fix`、`docs`、`test`、`refactor`、`perf`、`build`、`ci`、`chore`、`revert`。
- 范围：`gate`、`session`、`backends`、`local`、`ldap`、`config`、`docs`、`ci`、`deps`、`release`。
- 摘要用祈使语气、小写、句末不加句号、不超过 100 字符。
- 一个提交一个逻辑变更；每个提交单独都能构建并通过测试。

本地校验最近一次提交：

```sh
pnpm exec commitlint --from HEAD~1 --to HEAD
```

## 包管理器

本仓库**只使用 pnpm**。版本由 `package.json` 的 `packageManager` 锁定，`pnpm-lock.yaml` 入库；
`package-lock.json` 与 `yarn.lock` 一律不得出现在 pull request 中。请通过 `pnpm` 执行命令
（`pnpm run build`、`pnpm exec commitlint`），以保证所有贡献者与 CI 解析到同一份依赖图。

## Pull request

提交前先运行：

```sh
pnpm verify
```

`.github/PULL_REQUEST_TEMPLATE.md` 中的检查清单就是评审标准：

1. 本地 `pnpm verify` 通过。
2. 行为变更带测试；缺陷修复带回归测试。
3. 用户可见的变更在 `CHANGELOG.md` 的 `Unreleased` 下有条目。
4. 配置、安装方式或状态变化时，两个语言的 README 同步更新。
5. 做出或修订架构决策时，在 `docs/adr/` 新增 ADR。
6. 代码、测试、文档中都没有凭据、真实主机名或内部 DN。
7. 兼容性声明（`engines.dsh`）仍与 CI 实测范围一致。

评审者提出修改或批准；作者以 squash merge 合并，PR 标题即提交摘要。禁止对 `main` 强制推送。

## 发布

1. 更新 `CHANGELOG.md`：把 `Unreleased` 条目移入带今天日期的版本小节。
2. 修改 `package.json` 的 `version`（semver：pre-1.0 阶段行为变更升 minor，修复升 patch）。
3. 在 `main` 上打 `v<version>` 标签并推送。
4. `pnpm publish` 发布（需 2FA）；`prepack` 脚本会用 `tsc` 构建 `lib/`。
5. 开一个 pull request，把 `Unreleased` 恢复为空小节。

## 文档结构

| 位置                                     | 语言 | 用途                                     |
| ---------------------------------------- | ---- | ---------------------------------------- |
| `README.md`                              | 英文 | 入口、安装、配置、状态                   |
| `README.zh.md`                           | 中文 | 同内容，保持同步                         |
| `docs/design/`                           | 英文 | 每个子系统一篇设计说明，行为的真源       |
| `docs/ldap-integration.md`（+ `.zh.md`） | 双语 | 交给目录管理员的接入清单，两种语言须同步 |
| `docs/deployment.md`（+ `.zh.md`）       | 双语 | 主机部署、升级、备份与升级后检查清单     |
| `docs/adr/`                              | 英文 | 决策记录，含背景与否决的备选方案         |
| `docs/roadmap.md`                        | 英文 | 里程碑与验收标准                         |
| `AGENTS.md`                              | 英文 | 面向自动化贡献者的约定                   |

设计说明与代码不一致时，那就是 bug：在同一个 pull request 里修掉其中一方。

## 报告问题

用 issue 模板提交。请附上 `dsh` 版本、插件版本、`/auth-ldap/status` 文档（其中不含秘密）以及去掉凭据的
相关日志。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。
