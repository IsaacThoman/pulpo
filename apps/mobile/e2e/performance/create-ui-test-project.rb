# Generates an isolated XCTest UI runner; never modifies the application project.
require 'xcodeproj'
require 'fileutils'
root = File.expand_path(ARGV[0] || '/tmp/pulpo-performance-uitests')
FileUtils.mkdir_p(root)
project = Xcodeproj::Project.new(File.join(root, 'Performance.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'PerformanceUITests', :ios, '18.0')
target.add_file_references([project.main_group.new_file(File.expand_path('PerformanceUITests.swift', __dir__))])
target.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.pulpo.performance.uitests'
  config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  config.build_settings['SWIFT_VERSION'] = '5.0'
  config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
  config.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(project.path, 'PerformanceUITests', true)
