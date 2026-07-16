<script setup lang="ts">
import { onMounted } from "vue";
import { RouterView } from "vue-router";
import { useSessionStore } from "./stores/session";

const session = useSessionStore();

onMounted(() => session.bootstrap());
</script>

<template>
  <RouterView />
</template>
