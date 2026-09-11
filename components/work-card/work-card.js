Component({
  properties: {
    work: { type: Object, value: {} }
  },
  data: { imageError: false },
  observers: { 'work.imageUrl': function() { this.setData({imageError:false}); } },
  methods: {
    handleTap() {
      this.triggerEvent('select', { work: this.data.work });
    },
    handleImageError() {
      this.setData({ imageError: true });
    }
  }
});
