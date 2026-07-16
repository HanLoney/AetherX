<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{ name?: string; src?: string; size?: "small" | "medium" | "large" }>(), {
  name: "小玄",
  src: "",
  size: "medium"
});

const initial = computed(() => props.name.trim().slice(0, 1) || "玄");
</script>

<template>
  <div class="profile-avatar" :class="`avatar-${size}`" :aria-label="name">
    <img v-if="src" :src="src" alt="" />
    <span v-else>{{ initial }}</span>
  </div>
</template>
