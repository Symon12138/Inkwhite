use tauri_build::{Attributes, WindowsAttributes};

fn main() {
    // 主程序清单改由下方 embed_resource 统一提供（内容与 tauri-build 默认的
    // windows-app-manifest.xml 完全一致：仅 Common-Controls v6 依赖，资源 ID 同为
    // 1/RT_MANIFEST），因此用 new_without_app_manifest 禁用 tauri-build 自带的
    // 清单嵌入——避免同一资源 ID 出现两份 RT_MANIFEST，消除 GNU ld 的
    // ".rsrc merge failure: multiple non-default manifests" 警告。
    // 图标与版本信息资源仍由 tauri-build（tauri-winres）正常嵌入。
    tauri_build::try_build(
        Attributes::new().windows_attributes(WindowsAttributes::new_without_app_manifest()),
    )
    .expect("tauri-build 失败");

    // 为所有产物注入 comctl32 v6 清单（仓库级修复，替代会话级 RUSTFLAGS
    // manifest hack）：
    //
    // 背景：muda（tauri 菜单库）静态导入 comctl32.dll 的 TaskDialogIndirect，
    // 该导出仅存在于 comctl32 v6（需应用清单激活 side-by-side）。tauri-build
    // 的清单只作用于主程序（rustc-link-arg-bin=symark），测试 exe（lib 单测
    // 二进制、bin 测试 harness）无清单 → 加载时 0xc0000139
    // STATUS_ENTRYPOINT_NOT_FOUND（gnu 与 MSVC 工具链均受影响）。
    //
    // 为什么用 compile_for_everything 而非任务提示的 compile_for_tests：
    // compile_for_tests 发出 cargo:rustc-link-arg-tests，实测只作用于 [[test]]
    // 集成测试目标，不作用于本仓库所在的 lib 单测二进制（本仓库无 [[test]]，
    // 全部测试在 lib 内）。compile_for_everything 发出 cargo:rustc-link-arg，
    // 对 lib 单测二进制、bin 测试 harness、主程序等所有产物生效——配合上方
    // new_without_app_manifest，每份产物恰好携带一份清单，无重复无警告。
    //
    // 新增依赖说明（Cargo.toml）：embed-resource 已是 tauri-winres（tauri-build
    // 的传递依赖）的依赖，Cargo.lock 已锁定 3.0.11；此处仅提升为直接
    // build-dependency，不引入新版本、不新增网络下载。
    //
    // 仅 Windows 目标需要；非 Windows 构建跳过（compile_impl 对非 Windows
    // 返回 NotWindows，不产生副作用）。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        embed_resource::compile_for_everything(
            "resources/test-manifest.rc",
            embed_resource::NONE,
        )
        .manifest_required()
        .unwrap();
    }
}
