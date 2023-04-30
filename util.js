exports.htmlspecialchars = function(unsafeText) {
  if(typeof unsafeText !== 'string'){
    return unsafeText;
  }
  return unsafeText.replace(
    /[&'`"<>]/g, 
    function(match) {
      return {
        '&': '&amp;',
        "'": '&#x27;',
        '`': '&#x60;',
        '"': '&quot;',
        '<': '&lt;',
        '>': '&gt;',
      }[match]
    }
  );
}