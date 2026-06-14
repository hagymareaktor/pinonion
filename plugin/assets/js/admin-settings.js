document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.pp-radio-item input[type=radio]').forEach(function(r) {
        r.addEventListener('change', function() {
            const name = this.name;
            document.querySelectorAll('.pp-radio-item input[name="' + name + '"]').forEach(function(i) {
                i.closest('.pp-radio-item').classList.toggle('selected', i.checked);
            });
        });
    });
});
