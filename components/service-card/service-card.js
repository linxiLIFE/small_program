Component({
  properties: {
    service: { type: Object, value: {} },
    compact: { type: Boolean, value: false }
  },
  data: { imageError: false },
  methods: {
    handleTap() {
      this.triggerEvent('select', { service: this.data.service });
    },
    handleImageError() {
      this.setData({ imageError: true });
    }
  }
});
