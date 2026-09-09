Component({
  properties: {
    work: { type: Object, value: {} }
  },
  data: { imageError: false },
  methods: {
    handleTap() {
      this.triggerEvent('select', { work: this.data.work });
    },
    handleImageError() {
      this.setData({ imageError: true });
    }
  }
});
