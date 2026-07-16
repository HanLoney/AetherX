<script setup lang="ts">
import { Sparkles } from "@lucide/vue";
defineProps<{ title: string; description: string }>();
</script>

<template>
  <div class="empty-state">
    <i><Sparkles :size="22" /></i>
    <strong>{{ title }}</strong>
    <span>{{ description }}</span>
  </div>
</template>
