import { ref } from "vue";

const hidden = ref(false);

export function usePrimaryNavigation() {
  function setHidden(value: boolean) {
    hidden.value = value;
  }

  return {
    hidden,
    setHidden
  };
}
