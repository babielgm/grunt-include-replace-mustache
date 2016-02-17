/*
 * grunt-include-replace
 * https://github.com/alanshaw/grunt-include-replace
 *
 * Copyright (c) 2013 Alan Shaw
 * Licensed under the MIT license.
 */

module.exports = function(grunt) {

	'use strict';

	var _ = grunt.util._;
	var path = require('path');
	var mustache = require('mustache');

	grunt.registerMultiTask('includereplace', 'Include files and replace variables', function() {

		var options = this.options({
			prefix: '@@',
			suffix: '',
			globals: {},
			includesDir: '',
			docroot: '.',
			encoding: 'utf-8',
			useMustache: true,
			alwaysUnescaped: false
		});

		if(options.alwaysUnescaped) {
			mustache.escape = function(string) {
				return string;
			};
		}

		grunt.log.debug('Options', options);

		// Preset default encofing as early as possible
		grunt.file.defaultEncoding = options.encoding;

		// Variables available in ALL files
		var globalVars = options.globals;

		// Names of our variables
		var globalVarNames = Object.keys(globalVars);

		globalVarNames.forEach(function(globalVarName) {
			if (_.isString(globalVars[globalVarName])) {
				globalVars[globalVarName] = globalVars[globalVarName];
			} else {
				globalVars[globalVarName] = JSON.stringify(globalVars[globalVarName]);
			}
		});

		// Cached variable regular expressions
		var globalVarRegExps = {};

		function replace(contents, localVars) {

			localVars = localVars || {};

			var varNames = Object.keys(localVars);
			var varRegExps = {};


			// Mustache
			if(options.useMustache) {
				contents = mustache.to_html(contents, localVars);
			}

			// Replace local vars
			varNames.forEach(function(varName) {

				// Process lo-dash templates (for strings) in global variables and JSON.stringify the rest
				if (_.isString(localVars[varName])) {
					localVars[varName] = grunt.template.process(localVars[varName]);
				} else {
					localVars[varName] = JSON.stringify(localVars[varName]);
				}

				varRegExps[varName] = varRegExps[varName] || new RegExp(options.prefix + varName + options.suffix, 'g');

				contents = contents.replace(varRegExps[varName], localVars[varName]);
			});

			// Replace global variables
			globalVarNames.forEach(function(globalVarName) {

				globalVarRegExps[globalVarName] = globalVarRegExps[globalVarName] || new RegExp(options.prefix + globalVarName + options.suffix, 'g');

				contents = contents.replace(globalVarRegExps[globalVarName], globalVars[globalVarName]);
			});

			return contents;
		}

		var includeRegExp = new RegExp(options.prefix + 'include\\(\\s*["\'](.*?)["\'](,\\s*({[\\s\\S]*?})){0,1}\\s*\\)' + options.suffix);

		function include(contents, workingDir) {

			var matches = includeRegExp.exec(contents);

			// Create a function that can be passed to String.replace as the second arg
			function createReplaceFn (replacement) {
				return function () {
					return replacement;
				};
			}

			function getIncludeContents (includePath, localVars) {
				var files = grunt.file.expand(includePath),
					includeContents = '';

				// If files is not an array of at least one element then bad
				if (!files.length) {
					grunt.log.warn('Include file(s) not found', includePath);
				}

				files.forEach(function (filePath, index) {
					includeContents += grunt.file.read(filePath);
					// break a line for every file, except for the last one
					includeContents += index !== files.length-1 ? '\n' : '';

					// Make replacements
					includeContents = replace(includeContents, localVars);

					// Process includes
					includeContents = include(includeContents, path.dirname(filePath));
					if (options.processIncludeContents && typeof options.processIncludeContents === 'function') {
						includeContents = options.processIncludeContents(includeContents, localVars, filePath);
					}
				});

				return includeContents;
			}

			while (matches) {

				var match = matches[0];
				var includePath = matches[1];
				var localVars = matches[3] ? JSON.parse(matches[3]) : {};

				if (!grunt.file.isPathAbsolute(includePath)) {
					includePath = path.resolve(path.join((options.includesDir ? options.includesDir : workingDir), includePath));
				} else {
					if (options.includesDir) {
						grunt.log.error('includesDir works only with relative paths. Could not apply includesDir to ' + includePath);
					}
					includePath = path.resolve(includePath);
				}

				var docroot = path.relative(path.dirname(includePath), path.resolve(options.docroot)).replace(/\\/g, '/');

				// Set docroot as local var but don't overwrite if the user has specified
				if (localVars.docroot === undefined) {
					localVars.docroot = docroot ? docroot + '/' : '';
				}

				if (grunt.file.exists(includePath)) {
					grunt.log.debug('Including', includePath);
				}

				grunt.log.debug('Locals', localVars);

				var includeContents = getIncludeContents(includePath, localVars);
				contents = contents.replace(match, createReplaceFn(includeContents));

				matches = includeRegExp.exec(contents);
			}

			return contents;
		}

		this.files.forEach(function(config) {

			// Warn if source files aren't found
			config.orig.src.forEach(function(src) {
				if (src[0] === '!') { // Exclusion glob
					return;
				}

				var opts = {};

				if (config.orig.cwd) {
					opts.cwd = config.orig.cwd;
				}

				var srcs = grunt.file.expand(opts, src);

				if (!srcs.length) {
					grunt.log.warn('Source file(s) not found', src);
				}
			});

			config.src.forEach(function(src) {

				if (!grunt.file.isFile(src)) {
					return grunt.log.warn('Ignoring non file matching glob', src);
				}

				grunt.log.ok('Processing ' + src);

				// Read file
				var contents = grunt.file.read(src);

				var docroot = path.relative(path.dirname(src), path.resolve(options.docroot)).replace(/\\/g, '/');
				var localVars = {docroot: docroot ? docroot + '/' : ''};

				grunt.log.debug('Locals', localVars);

				// Make replacements
				contents = replace(contents, localVars);

				// Process includes
				contents = include(contents, path.dirname(src));

				//grunt.log.debug(contents);

				var dest = config.dest;

				if (isDirectory(dest) && !config.orig.cwd) {
					dest = path.join(dest, src);
				}

				grunt.log.debug('Saving to', dest);

				grunt.file.write(dest, contents);

				grunt.log.ok('Processed ' + src);
			});
		});
	});

	// Detect if destination path is a directory
	function isDirectory (dest) {
		return grunt.util._.endsWith(dest, '/');
	}
};
