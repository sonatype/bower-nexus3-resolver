/*
 * Copyright (c) 2008-present Sonatype, Inc.
 *
 * All rights reserved. Includes the third-party code listed at http://links.sonatype.com/products/nexus/oss/attributions.
 *
 * This program and the accompanying materials are made available under the terms of the Eclipse Public License Version 1.0,
 * which accompanies this distribution and is available at http://www.eclipse.org/legal/epl-v10.html.
 *
 * Sonatype Nexus (TM) Repository Manager is available from Sonatype, Inc. "Sonatype" and "Sonatype Nexus" are trademarks
 * of Sonatype, Inc. Apache Maven is a trademark of the Apache Software Foundation. M2eclipse is a trademark of the
 * Eclipse Foundation. All other trademarks are the property of their respective owners.
 */

var NEXUS_REGEX = /^nexus\+/;

var fs = require('fs');
var path = require('path');
var request = require('request');
var Q = require('q');
var tar = require('tar');
var tmp = require('tmp');
var url = require('url');
var zlib = require('zlib');

tmp.setGracefulCleanup();

module.exports = function resolver(bower) {

  return {

    match: function(source) {
      return NEXUS_REGEX.test(source);
    },

    locate: function(source) {
      return source;
    },

    releases: function(source) {
      var self = this;
      var parsed = self._parseNexusUrl(source);
      var refsUrl = self._buildNexusVersionsEndpoint(parsed);
      return self._downloadString(refsUrl).then(function(data) {
        return self._parseVersions(data);
      });
    },

    fetch: function(endpoint, cached) {
      var self = this;
      if (cached && cached.version) {
        return;
      }
      var parsed = self._parseNexusUrl(endpoint.source);
      var archiveUrl = self._buildNexusArchiveEndpoint(parsed, endpoint.target);
      return self._downloadFile(archiveUrl, tmp.tmpNameSync())
          .then(function(filename) {
            return self._extractTarGz(filename);
          })
          .then(function(path) {
            return {
              tempPath: path,
              removeIgnores: true
            };
          });
    },

    /**
     * Parses a Nexus url into an object containing the hostname, port, repository, and package names.
     *
     * @param {String} nexusUrl The Nexus URL to parse.
     * @returns {Object} The extracted information for the URL.
     * @private
     */
    _parseNexusUrl: function(nexusUrl) {
      var parsed = url.parse(nexusUrl.replace(NEXUS_REGEX, ''));
      var segments = parsed.pathname.split('/');
      return {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: '/' + segments.slice(1, segments.length - 2).join('/'),
        repositoryName: segments[segments.length - 2],
        packageName: segments[segments.length - 1]
      };
    },

    /**
     * Builds the http url to the refs endpoint for a particular parsed Nexus URL.
     *
     * @param {Object} parsedNexusUrl The object containing the parsed Nexus URL information.
     * @returns {String} The URL
     * @private
     */
    _buildNexusVersionsEndpoint: function(parsedNexusUrl) {
      return url.format({
        protocol: parsedNexusUrl.protocol,
        hostname: parsedNexusUrl.hostname,
        port: parsedNexusUrl.port,
        pathname: parsedNexusUrl.path + '/' + parsedNexusUrl.repositoryName + '/' + parsedNexusUrl.packageName +
          '/versions.json',
        auth: this._buildAuth()
      });
    },

    /**
     * Builds the http url to the archive endpoint for a particular parsed Nexus URL.
     *
     * @param {Object} parsedNexusUrl The object containing the parsed Nexus URL information.
     * @param {String} target The target version to download.
     * @returns {String} The formatted URL.
     * @private
     */
    _buildNexusArchiveEndpoint: function(parsedNexusUrl, target) {
      return url.format({
        protocol: parsedNexusUrl.protocol,
        hostname: parsedNexusUrl.hostname,
        port: parsedNexusUrl.port,
        pathname: parsedNexusUrl.path + '/' + parsedNexusUrl.repositoryName + '/' + parsedNexusUrl.packageName + '/' +
          target + '/package.tar.gz',
        auth: this._buildAuth()
      });
    },

    /**
     * Builds the auth portion of a URL using the provided Nexus-specific configuration parameters.
     *
     * @returns {String} The auth username and password string, or null if credentials are not present.
     * @private
     */
    _buildAuth: function() {
      if (bower.config.nexus && bower.config.nexus.username && bower.config.nexus.password) {
        return bower.config.nexus.username + ':' + bower.config.nexus.password;
      }
      return null;
    },

    /**
     * Extracts the version information from a Nexus versions endpoint response.
     *
     * @param {String} data The stringified JSON array containing version numbers as strings.
     * @returns {Array} The array containing the extracted target and version information.
     * @private
     */
    _parseVersions: function(data) {
      return JSON.parse(data).map(function(entry) {
        return {
          target: entry,
          version: entry
        };
      });
    },

    /**
     * Returns the path to use when determining the temporary directory path for the extracted archive. If the files
     * contain one and only one new file, and it is a directory, then that directory should be returned. In all other
     * situations, the original extraction directory should be returned instead.
     *
     * @param {String} tempDirName The name of the temporary directory.
     * @param {Array} beforeFiles The collection of files existing before the extraction.
     * @param {Array} afterFiles The collection of files existing after the extraction.
     * @returns {String} The temporary directory name to use.
     * @private
     */
    _getTempPath: function(tempDirName, beforeFiles, afterFiles) {
      var difference = afterFiles.filter(function(each) {
        return beforeFiles.indexOf(each) === -1;
      });
      if (difference.length === 1) {
        var name = path.resolve(tempDirName, difference[0]);
        var stats = fs.statSync(name);
        if (stats.isDirectory()) {
          return name;
        }
      }
      return tempDirName;
    },

    /**
     * Downloads the contents of the specified URL to the specified filename, returning a promise.
     *
     * @param {String} url The URL to download from.
     * @param {String} filename The filename to save to.
     * @returns {Promise} The Promise representing the download operation.
     * @private
     */
    _downloadFile: function(url, filename) {
      var self = this;
      return Q.Promise(function(resolve, reject) {
        request(self._buildRequestConfig(url, null))
            .on('error', function(error) {
              reject(error);
            })
            .on('response', function(response) {
              if (response.statusCode !== 200) {
                reject(new Error(url + ' (HTTP ' + response.statusCode + ')'));
              }
            })
            .pipe(fs.createWriteStream(filename)).on('finish', function() {
              resolve(filename);
            });
      });
    },

    /**
     * Downloads the contents of the specified URL into a string.
     *
     * @param {String} url The URL to download.
     * @returns {Promise} The Promise representing the download.
     * @private
     */
    _downloadString: function(url) {
      var self = this;
      return Q.Promise(function(resolve, reject) {
        request(self._buildRequestConfig(url, 'utf-8'), function(error, response, body) {
          if (error) {
            reject(error);
          }
          else if (response.statusCode !== 200) {
            reject(new Error(url + ' (HTTP ' + response.statusCode + ')'));
          }
          else {
            resolve(body);
          }
        }).on('error', function(error) {
          reject(error);
        });
      });
    },

    /**
     * Extracts a downloaded .tar.gz to a temporary directory, returning the path to the extracted contents. Adjustments
     * to the path are made for special cases that must be handled, such as extracted content that contains only a
     * unique subdirectory.
     *
     * @param {String} filename The filename to extract.
     * @returns {Promise} The Promise representing the extract operation.
     * @private
     */
    _extractTarGz: function(filename) {
      var self = this;
      return Q.promise(function(resolve, reject) {
        var tempDir = tmp.dirSync();
        var beforeFiles = fs.readdirSync(tempDir.name);

        var readStream = fs.createReadStream(filename);
        readStream.on('error', function(err) {
          reject(err);
        });

        var zlibStream = zlib.createGunzip();
        zlibStream.on('error', function(err) {
          reject(err);
        });

        var tarStream = tar.Extract({path: tempDir.name});
        tarStream.on('error', function(err) {
          reject(err);
        });
        tarStream.on('finish', function() {
          var afterFiles = fs.readdirSync(tempDir.name);
          resolve(self._getTempPath(tempDir.name, beforeFiles, afterFiles));
        });

        readStream.pipe(zlibStream).pipe(tarStream);
      });
    },

    /**
     * Builds a request configuration for a particular url and the provided Bower configuration.
     *
     * @param {String} url The url to access.
     * @param {String} encoding The encoding (null for binary downloads)
     * @return {Object} The configuration including Bower settings.
     * @private
     */
    _buildRequestConfig: function(url, encoding) {
      return {
        url: url,
        encoding: encoding,
        strictSSL: bower.config.strictSsl,
        ca: bower.config.ca ? bower.config.ca.default : null,
        timeout: bower.config.timeout
      }
    }
  }
};
