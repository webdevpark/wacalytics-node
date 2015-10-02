/* global process */
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
    var environment = argv.e || 'development';

    switch (environment) {
        case 'development':
            console.log('[wacalytics] ... Running locally ...');

            break;
        case 'stage-mongo':
            console.log('[wacalytics] ... Deploying to AWS stage environment with MongoDB database ...');

            break;
        case 'live-mongo':
            console.log('[wacalytics] ... Deploying to AWS live environment with MongoDB database ...');

            break;
        case 'stage-sql':
            console.log('[wacalytics] ... Deploying to AWS stage environment with SQL database ...');

            break;
        case 'live-sql':
            console.log('[wacalytics] ... Deploying to AWS live environment with SQL database ...');

            break;
    }

    return gulp.src('./configs/config.' + environment + '.env')
        .pipe(rename('.env'))
        .pipe(gulp.dest('./'));
});

gulp.task('deploy', ['build', 'config'], function() {
    var environment = argv.e,
        configPath = './configs/secret.' + environment + '.env',
        command =
            'node-lambda deploy --configFile ' + configPath;

    if (!environment) {
        console.error('No environment specified');
    } else {
        exec(command, function (err, stdout, stderr) {
            console.log(stdout);
            console.log(stderr);
        });
    }
});

gulp.task('run', ['build', 'config'], function() {
    var command = 'node-lambda run';

    exec(command, function (err, stdout, stderr) {
        console.log(stdout);
        console.log(stderr);
    });
});

gulp.task('default', ['deploy']);