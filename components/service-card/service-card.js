Component({
  properties: {
    service: { type: Object, value: {} },
    compact: { type: Boolean, value: false },
    selected: { type: Boolean, value: false }
  },
  data: { imageError: false, imageFallbackAttempted: false },
  observers: {
    'service.coverUrl, service.coverRemoteUrl': function() {
      this.setData({ imageError: false, imageFallbackAttempted: false });
    }
  },
  methods: {
    handleTap() {
      this.triggerEvent('select', { service: this.data.service });
    },
    handleImageError() {
      const service = this.data.service || {};
      if (!this.data.imageFallbackAttempted && service.coverRemoteUrl && service.coverRemoteUrl !== service.coverUrl) {
        this.setData({ imageFallbackAttempted: true });
        return;
      }
      this.setData({ imageError: true });
    }
  }
});
