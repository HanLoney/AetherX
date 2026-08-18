<script setup lang="ts">
import { computed } from "vue";
import { Cloud, CloudOff, RefreshCw } from "@lucide/vue";
import { useLocalHub } from "../lib/local-hub";
import { useDataStore } from "../stores/data";

const data = useDataStore();
const localHub = useLocalHub();
const state = computed(() => {
  const replication = localHub.status.value;
  if (
    data.syncState.value === "error" &&
    replication?.configured &&
    replication.bootstrap?.status === "completed" &&
    replication.synchronization.state === "synced"
  ) return "recovering";
  return data.syncState.value;
});
const label = computed(() => ({
  idle: "待连接",
  syncing: "连接中",
  online: "已连接",
  recovering: "通道重连中",
  error: "离线"
})[state.value]);
const icon = computed(() => state.value === "error" ? CloudOff : ["syncing", "recovering"].includes(state.value) ? RefreshCw : Cloud);
</script>

<template>
  <span class="connection-pill" :class="state">
    <component :is="icon" :size="14" :class="{ spin: state === 'syncing' || state === 'recovering' }" />
    {{ label }}
  </span>
</template>
