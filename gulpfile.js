var gulp            = require('gulp'),
    jshint          = require('gulp-jshint'),
    stylish         = require('jshint-stylish'),
    jscs            = require('gulp-jscs'),
    exec            = require('child_process').exec,
    argv            = require('yargs').argv,
    rename          = require('gulp-rename');

gulp.task('code-style', function() {
    return gulp.src([
        './*.js',
        './app/*.js',
        './schemas/*.js'
    ])
        .pipe(jscs({
            configPath: '.jscsrc'
        }));
});

gulp.task('lint', function() {
    return gulp.src([
        './*.js',
        './app/*.js',
        './schemas/*.js'
    ])
        .pipe(jshint('./.jshintrc'))
        .pipe(jshint.reporter(stylish))
        .pipe(jshint.reporter('fail'));
});

gulp.task('build', ['code-style', 'lint']);

gulp.task('config', function() {
    var env = argv.run ? 'development' : 'production';

    return gulp.src('./configs/config.env.' + env)
        .pipe(rename('.env'))
        .pipe(gulp.dest('./'));
});

gulp.task('exec', function() {
    var command = argv.run ? 'run' : 'deploy';

    exec('node-lambda ' + command, function (err, stdout, stderr) {
        console.log(stdout);
        console.log(stderr);
    });
});

gulp.task('default', ['build', 'config', 'exec']);