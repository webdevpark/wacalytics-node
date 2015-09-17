var gulp            = require('gulp'),
    jshint          = require('gulp-jshint'),
    stylish         = require('jshint-stylish'),
    jscs            = require('gulp-jscs'),
    uglify          = require('gulp-uglify'),
    sourcemaps      = require('gulp-sourcemaps'),
    exec            = require('child_process').exec;

gulp.task('code-style', function() {
    return gulp.src([
        './*.js'
    ])
        .pipe(jscs({
            configPath: '.jscsrc'
        }));
});

gulp.task('lint', function() {
    return gulp.src([
        './*.js'
    ])
        .pipe(jshint('./.jshintrc'))
        .pipe(jshint.reporter(stylish))
        .pipe(jshint.reporter('fail'));
});

gulp.task('build', ['code-style', 'lint']);

gulp.task('deploy', ['build'], function() {
    return exec('node-lambda deploy', function (err, stdout, stderr) {
        console.log(stdout);
        console.log(stderr);
    });
});