<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "../lib/markdown";

const props = defineProps<{ content?: string | null }>();
const html = computed(() => renderMarkdown(props.content));
</script>

<template>
  <!-- Raw HTML is disabled by the renderer; only generated Markdown markup reaches v-html. -->
  <div class="markdown-message" v-html="html" />
</template>

<style scoped>
.markdown-message { min-width: 0; overflow-wrap: anywhere; }
.markdown-message :deep(> :first-child) { margin-top: 0; }
.markdown-message :deep(> :last-child) { margin-bottom: 0; }
.markdown-message :deep(p) { margin: 0 0 .72em; }
.markdown-message :deep(h1),
.markdown-message :deep(h2),
.markdown-message :deep(h3),
.markdown-message :deep(h4) { margin: 1.1em 0 .52em; color: #3f3a50; line-height: 1.38; letter-spacing: -.02em; }
.markdown-message :deep(h1) { font-size: 1.35em; }
.markdown-message :deep(h2) { font-size: 1.22em; }
.markdown-message :deep(h3), .markdown-message :deep(h4) { font-size: 1.08em; }
.markdown-message :deep(strong) { color: #403b50; font-weight: 750; }
.markdown-message :deep(em) { color: #696276; }
.markdown-message :deep(a) { color: #698db5; text-decoration: underline; text-decoration-color: rgba(105,141,181,.35); text-underline-offset: 3px; }
.markdown-message :deep(ul), .markdown-message :deep(ol) { margin: .55em 0 .75em; padding-left: 1.55em; }
.markdown-message :deep(li) { margin: .22em 0; }
.markdown-message :deep(blockquote) { margin: .72em 0; padding: .28em 0 .28em .9em; border-left: 3px solid rgba(200,131,170,.5); color: #766f80; background: linear-gradient(90deg,rgba(235,166,199,.09),transparent); }
.markdown-message :deep(code) { padding: .15em .4em; border: 1px solid rgba(137,128,157,.13); border-radius: 6px; color: #866079; background: rgba(245,238,246,.78); font-family: "SFMono-Regular", Consolas, monospace; font-size: .9em; }
.markdown-message :deep(pre) { max-width: 100%; margin: .75em 0; padding: 12px 13px; overflow-x: auto; border: 1px solid rgba(125,118,149,.14); border-radius: 13px; color: #eeeaf4; background: #34313f; line-height: 1.55; -webkit-overflow-scrolling: touch; }
.markdown-message :deep(pre code) { padding: 0; border: 0; color: inherit; background: transparent; white-space: pre; }
.markdown-message :deep(table) { display: block; max-width: 100%; margin: .75em 0; overflow-x: auto; border-collapse: collapse; -webkit-overflow-scrolling: touch; }
.markdown-message :deep(th), .markdown-message :deep(td) { min-width: 80px; padding: 7px 9px; border: 1px solid rgba(126,117,148,.17); text-align: left; white-space: nowrap; }
.markdown-message :deep(th) { color: #5c5669; background: rgba(235,228,240,.72); }
.markdown-message :deep(hr) { margin: 1em 0; border: 0; border-top: 1px solid rgba(122,115,141,.17); }
.markdown-message :deep(img) { display: block; width: auto; max-width: 100%; max-height: 360px; margin: .72em 0; border-radius: 14px; object-fit: contain; box-shadow: 0 9px 26px rgba(65,60,84,.12); }
</style>
