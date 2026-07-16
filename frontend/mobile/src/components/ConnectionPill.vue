<script setup lang="ts">
import { computed } from "vue";
import { Cloud, CloudOff, RefreshCw } from "@lucide/vue";
import { useDataStore } from "../stores/data";

const data = useDataStore();
const label = computed(() => ({ idle: "待连接", syncing: "同步中", online: "已同步", error: "离线" })[data.syncState.value]);
const icon = computed(() => data.syncState.value === "error" ? CloudOff : data.syncState.value === "syncing" ? RefreshCw : Cloud);
</script>

<template>
  <span class="connection-pill" :class="data.syncState.value">
    <component :is="icon" :size="14" :class="{ spin: data.syncState.value === 'syncing' }" />
    {{ label }}
  </span>
</template>
