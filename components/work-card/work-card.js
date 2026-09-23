Component({
  properties: {
    work: { type: Object, value: {} },
    selected: { type: Boolean, value: false }
  },
  data: { imageError: false, imageFallbackAttempted: false },
  observers: { 'work.imageUrl, work.imageRemoteUrl': function() { this.setData({imageError:false, imageFallbackAttempted:false}); } },
  methods: {
    handleTap() {
      this.triggerEvent('select', { work: this.data.work });
    },
    handleImageError() {
      const work = this.data.work || {};
      if (!this.data.imageFallbackAttempted && work.imageRemoteUrl && work.imageRemoteUrl !== work.imageUrl) {
        this.setData({ imageFallbackAttempted: true });
        return;
      }
      this.setData({ imageError: true });
    }
  }
});
