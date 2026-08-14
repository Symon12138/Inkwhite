// 桌面端唯一入口：直接加载编辑器，不再有落地页和 hash 路由。
// editorEntry 会加载样式、挂载 window.React/marked、导入 dc-runtime，然后由
// index.html 中的 <script type="text/x-dc"> 负责创建组件实例。
import './editorEntry';
