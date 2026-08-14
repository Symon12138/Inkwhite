// @ts-nocheck

// 打字机模式：当前行始终在视口垂直中心。
// 监听 source textarea 的光标位置变化，调整 scrollTop 使当前行居中。
export class TypewriterMethods {
  toggleTypewriterMode(force) {
    this.typewriterActive = typeof force === 'boolean' ? force : !this.typewriterActive;
    this._applyTypewriterMode();
    this._persist();
    this._setStatus(this.typewriterActive ? '已开启打字机模式' : '已关闭打字机模式');
  }


  _applyTypewriterMode() {
    const split = this.splitRef && this.splitRef.current;
    if (split) split.classList.toggle('typewriter-mode', !!this.typewriterActive);
    if (this.typewriterActive) this._applyTypewriterScroll();
  }


  _applyTypewriterScroll() {
    if (!this.typewriterActive) return;
    const src = this.sourceRef.current;
    if (!src) return;
    // 用 textarea 的属性估算当前行的垂直位置
    const pos = src.selectionStart;
    const text = src.value.substring(0, pos);
    const lineNum = text.split('\n').length - 1;
    const lineHeight = parseFloat(getComputedStyle(src).lineHeight) || 24;
    const targetY = lineNum * lineHeight;
    const halfHeight = src.clientHeight / 2;
    src.scrollTop = Math.max(0, targetY - halfHeight);
  }
}
