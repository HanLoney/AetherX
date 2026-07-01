<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";

onLaunch(() => {
  console.info("AetherX UniApp launched");
});
</script>

<style>
page {
  min-height: 100%;
  color: #4f4b61;
  background: #f7f6fb;
  font-family:
    "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
}

view,
text,
button,
input {
  box-sizing: border-box;
}

button::after {
  border: 0;
}
</style>
