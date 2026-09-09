Component({
  properties: {
    eyebrow: { type: String, value: '' },
    title: { type: String, value: '' },
    linkText: { type: String, value: '' }
  },
  methods: {
    handleLink() {
      this.triggerEvent('link');
    }
  }
});
