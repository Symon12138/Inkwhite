// @ts-nocheck
// Typora 风格菜单栏 + 顶栏溢出菜单：开合、互斥、外部点击/Esc 关闭。
// 依赖 index.html 中 .menubar-item[data-menubar=key] 内 .menubar-trigger / .menubar-menu。

export class MenubarMethods {
  // ===== 小屏顶栏溢出菜单（⋯） =====

  toggleHeaderMenu(force) {
    const menu = this.headerMenuRef.current;
    const more = this.headerMoreRef.current;
    if (!menu) return;
    const open = typeof force === 'boolean' ? force : !menu.classList.contains('is-open');
    menu.classList.toggle('is-open', open);
    if (more) more.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && !this._headerMenuDocH) {
      this._headerMenuDocH = (e) => {
        if (menu.contains(e.target)) return;
        if (more && (e.target === more || more.contains(e.target))) return;
        this.toggleHeaderMenu(false);
      };
      document.addEventListener('click', this._headerMenuDocH);
    } else if (!open && this._headerMenuDocH) {
      document.removeEventListener('click', this._headerMenuDocH);
      this._headerMenuDocH = null;
    }
  }

  // ===== Typora 风格菜单栏（文件/编辑/段落/格式/视图/主题/帮助）=====

  /**
   * 菜单栏通用开关：key 为空串时关闭全部菜单；否则切换该菜单并互斥关闭其他。
   */
  toggleMenubar(key) {
    if (typeof document === 'undefined') return;
    const items = [...document.querySelectorAll('.menubar-item')];
    let target = null;
    if (key) target = items.find((it) => it.getAttribute('data-menubar') === key);
    const willOpen = key && target && !target.classList.contains('is-open');
    for (const it of items) {
      const open = it === target && willOpen;
      it.classList.toggle('is-open', open);
      const trigger = it.querySelector('.menubar-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (willOpen) {
      if (!this._menubarDocH) {
        // 实时判断点击是否落在任一打开菜单内，不依赖首次打开的 target 闭包（DOM 可能被重渲染替换）
        this._menubarDocH = (e) => {
          if (e.target.closest && e.target.closest('.menubar-trigger')) return;
          const openMenus = document.querySelectorAll('.menubar-item.is-open .menubar-menu');
          for (const m of openMenus) if (m.contains(e.target)) return;
          this.toggleMenubar('');
        };
        document.addEventListener('click', this._menubarDocH);
        document.addEventListener('keydown', this._menubarKeyH = (e) => {
          if (e.key === 'Escape') this.toggleMenubar('');
        });
      }
    } else if (!key && this._menubarDocH) {
      document.removeEventListener('click', this._menubarDocH);
      this._menubarDocH = null;
      if (this._menubarKeyH) document.removeEventListener('keydown', this._menubarKeyH);
      this._menubarKeyH = null;
    }
  }
}
