# @harperdb/prometheus-exporter

![NPM Version](https://img.shields.io/npm/v/%40harperdb%2Fprometheus-exporter)

[Harper's](https://www.harpersystems.dev/) Prometheus Exporter. This Application exposes Node.js and Harper metrics via a /metrics endpoint.  
This exporter plugs in directly to an instance of Harper and responds to Prometheus scrapes.

> [!NOTE]
> This exporter will only work with Harper v4.2 or higher. (If you are looking for a compatible version for below v4.2 check [here](https://github.com/HarperDB/prometheus_exporter/releases/tag/v0.1.1))

## Harper Setup
### Instructions for v4.2.0 and higher (including beta releases)
1. Note your components port:

   Look in your `$hdb/harperdb-config.yaml`. You will find the section:
    ```yaml
    http:
      compressionThreshold: 1200
      cors: false
      corsAccessList:
         - null
      keepAliveTimeout: 30000
      port: 9926
      securePort: null
      sessionAffinity: null
      timeout: 120000
   ```
   Note your defined `port`. Please reference [Harper configuration documentation](https://docs.harperdb.io/docs/deployments/configuration#http) for more details.
2. Clone this repo to the `$hdb/components` directory of your Harper instance.
3. From the `$hdb/components/prometheus_exporter` folder run `npm install`
4. [Restart Components]([https://docs.harperdb.io/docs/developers/applications#restarting-your-instance]).

## Prometheus Setup
Some small configuration changes are needed in your prometheus.yml to tell Prometheus the address of the Harper Exporter metrics end point.
To know what port to use you should reference bullet point 1 in Harper Setup.
A Harper Custom Function project creates a path off of the host address.  The default for this exporter project would be `/prometheus_exporter/metrics`. If you rename this project's
A sample prometheus configuration would look like:
```yaml
scrape_configs:
  - job_name: "prometheus"
    metrics_path: "/prometheus_exporter/metrics"

    static_configs:
      - targets: ["localhost:9926"]
        labels:
          node: 'node-alpha'
```
We define a custom `metrics_path` to tell Prometheus where to access the Harper Exporter path.  You can also see we added a label for our target, we recommend doing similar for your configuration to allow for filtering between instance metrics.

## Exporter Settings
Metric access is controlled by three settings that can be configured using the [REST](https://docs.harperdb.io/docs/developers/rest) endpoint for `prometheus_exporter/PrometheusExporterSettings`. The user used to authenticate these REST requests must have write access to the table `PrometheusExporterSettings`:
1. `forceAuthorization`
  * `true` or `false`. If true, you must authenticate with Harper in order to access the metrics endpoint `/prometheus_exporter/metrics`
2. `authorizedUsers`
   * Array of Username (Harper users) strings. Only used if `forceAuthorization` is `true`. If empty, the user used to authenticate must be a `super_user`. If there are any strings in the array, those users will be authorized to access as well as any super users.
3. `customMetrics`
   * Object array of values that define converting Harper custom metric(s) to Prometheus metric(s). The definition is as follows:
     * `metricAttribute` (required): The Harper metric name that needs to be processed as a custom Prometheus metric.
     * `help` (required): The help text to be associated with the Prometheus metric.
     * `labels` (required): Object array of label definitions for the Prometheus metric. The definition for labels:
       * `label` (required): Name of the Prometheus label.
       * `metricAttribute` (required): Name of the Harper label that maps to the Prometheus label.
       * `delimiter` (optional): If the label value is a concatenated string, this defines the delimiter with which to split the data.
       * `index` (optional / required with delimiter): This is used in conjunction with the delimiter attribute.  This creates the mapping from the split label value, based on delimiter, to the Prometheus label value.  `index` can also be used independently of delimiter if the Harper label value is an array.
    
     Example `customMetrics` value:      
     ```json
     {
        "name": "customMetrics",
         "value": [
        {
           "name": "myCoolMetric",
           "metricAttribute": "metric",
           "help": "this is the coolest metric",
           "labels": [
             {
                "label": "coolLabel",
                "metricAttribute": "path"
                "delimiter": "::"
                "index": 0
             },
             {
                "label": "coolerLabel",
                "metricAttribute": "path"
                "delimiter": "::"
                "index": 1
             },
             {
                "label": "coolestLabel",
                "metricAttribute": "path"
                "delimiter": "::"
                "index": 2
             },
             {
                "label": "httpMethod",
                "metricAttribute": "method"
             },
             {
                "label": "statusCode",
                "metricAttribute": "type"
             }
           ]
       }
     ]
   }
      ```


### Example REST commands
```bash
curl --location --request PUT 'http://localhost:9926/prometheus_exporter/PrometheusExporterSettings/forceAuthorization' \
--header 'Content-Type: application/json' \
--header 'Authorization: Basic abcd' \
--data '{
    "value": true
}'
```

```bash
curl --location --request PUT 'http://localhost:9926/prometheus_exporter/PrometheusExporterSettings/allowedUsers' \
--header 'Content-Type: application/json' \
--header 'Authorization: Basic abcd' \
--data '{
    "value": ["prometheus"]
}'
```

```bash
curl --location --request PUT 'http://localhost:9926/prometheus_exporter/PrometheusExporterSettings/customMetrics' \
--header 'Content-Type: application/json' \
--header 'Authorization: Basic abcd' \
--data '{
   "name": "customMetrics",
    "value": [
   {
      "name": "myCoolMetric",
      "metricAttribute": "metric",
      "help": "this is the coolest metric",
      "labels": [
        {
           "label": "coolLabel",
           "metricAttribute": "path"
           "delimiter": "::"
           "index": 0
        },
        {
           "label": "coolerLabel",
           "metricAttribute": "path"
           "delimiter": "::"
           "index": 1
        },
        {
           "label": "coolestLabel",
           "metricAttribute": "path"
           "delimiter": "::"
           "index": 2
        },
        {
           "label": "httpMethod",
           "metricAttribute": "method"
        },
        {
           "label": "statusCode",
           "metricAttribute": "type"
        }
      ]
  }
]'
```

## Metrics
We expose default metrics from the [Prometheus client](https://github.com/siimon/prom-client); a list of the metrics can be found [here](https://github.com/siimon/prom-client/blob/master/example/default-metrics.js).

Metrics specific to Harper (all metrics are [Gauges](https://prometheus.io/docs/concepts/metric_types/#gauge)):

| Metric                                   | Description                                                                                                                                                                                                                                                                       |
|------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `harperdb_table_puts_total`              | Total number of non-delete writes by table.                                                                                                                                                                                                                                       |
| `harperdb_table_deletes_total`           | Total number of deletes by table.                                                                                                                                                                                                                                                 |
| `harperdb_table_txns_total`              | Total number of transactions by table.                                                                                                                                                                                                                                            |
| `harperdb_table_page_flushes_total`      | Total number of times all pages have been flushed for a table. Harper batches writes to disk for better performance, and this metric tracks how many times these batch writes have occurred at the disk level.                                                                    |
| `harperdb_table_writes_total`            | Total number of disk write operations by table.                                                                                                                                                                                                                                   |
| `harperdb_table_pages_written_total`     | Total number of pages written to disk by table. This is higher than writes because sequential pages can be written in a single write operation.                                                                                                                                   |
| `harperdb_table_time_during_txns_total`  | Total time from when transaction was started (lock acquired) until finished and all writes have been made (but not necessarily flushed/synced to disk) by table.                                                                                                                  |
| `harperdb_table_time_start_txns_total`   | Total time spent waiting for transaction lock acquisition by table.                                                                                                                                                                                                               |
| `harperdb_table_time_page_flushes_total` | Total time spent on write calls by table.                                                                                                                                                                                                                                         |
| `harperdb_table_time_sync_total`         | Total time spent on write calls by table.                                                                                                                                                                                                                                         |
| `harperdb_process_threads_count`         | Number of threads in the Harper core process.                                                                                                                                                                                                                                     |
| `harperdb_process_cpu_utilization`       | CPU utilization of a Harper process.                                                                                                                                                                                                                                              |
| `connection`                             | Number of successful connection attempts by protocol                                                                                                                                                                                                                              |
| `open_connections`                       | Average number of connections across all threads                                                                                                                                                                                                                                  |
| `bytes_sent`                             | Bytes sent by protocol                                                                                                                                                                                                                                                            |
| `bytes_received`                         | Bytes received by protocol                                                                                                                                                                                                                                                        |
| `cache_hit`                              | Number of cache hits by table                                                                                                                                                                                                                                                     |
| `cache_miss`                             | Number of cache misses by table                                                                                                                                                                                                                                                   |
| `success`                                | Number of success requests by endpoint                                                                                                                                                                                                                                            |
| `duration`                               | Time for Harper to execute request in ms                                                                                                                                                                                                                                          |
| `cache_resolution`                       | Time to resolve a cache miss                                                                                                                                                                                                                                                      |
| `transfer`                               | Total time spent transferring the response (in ms), from the first header packet to the final packet. Harper honors "back-pressure," so if the client/network is slow, transfer is paced to prevent buffer overload. This reflects how long it takes to deliver larger responses. |
| `filesystem_size_bytes`                  | Filesystem size in bytes.                                                                                                                                                                                                                                                         |
| `filesystem_free_bytes`                  | Filesystem free space in bytes.                                                                                                                                                                                                                                                   |
| `filesystem_used_bytes`                  | Filesystem space used in bytes.                                                                                                                                                                                                                                                   |
| `cluster_ping`                           | Cluster ping latency in milliseconds for connected nodes.                                                                                                                                                                                                                         |
| `cluster_connected_dbs`                  | Count of connected dbs by node.                                                                                                                                                                                                                                                   |
| `cluster_disconnected_dbs`               | Count of disconnected dbs by node.                                                                                                                                                                                                                                                |
| `replication_backlog`                    | Number of pending replication consumers by origin, database, & table (for NATS replication only).                                                                                                                                                                                 |
| `replication_backlog_time`               | The difference in milliseconds between lastReceivedRemoteTime and lastReceivedLocalTime for each of the node's dbs (for Harper replication only).                                                                                                                                 |
| `replication_latency`                    | The difference in milliseconds between incoming transactions' timestamps (as recorded remotely) and the time when each transaction finished committing locally (for Harper replication only).                                                                                     |                                                                                                                                                              

A complete sample response of `/metrics`:
```text
# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds.
# TYPE process_cpu_user_seconds_total counter
process_cpu_user_seconds_total 0.059909

# HELP process_cpu_system_seconds_total Total system CPU time spent in seconds.
# TYPE process_cpu_system_seconds_total counter
process_cpu_system_seconds_total 0.023711

# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.
# TYPE process_cpu_seconds_total counter
process_cpu_seconds_total 0.08362

# HELP process_start_time_seconds Start time of the process since unix epoch in seconds.
# TYPE process_start_time_seconds gauge
process_start_time_seconds 1687558304

# HELP process_resident_memory_bytes Resident memory size in bytes.
# TYPE process_resident_memory_bytes gauge
process_resident_memory_bytes 826392576

# HELP process_virtual_memory_bytes Virtual memory size in bytes.
# TYPE process_virtual_memory_bytes gauge
process_virtual_memory_bytes 28277252096

# HELP process_heap_bytes Process heap size in bytes.
# TYPE process_heap_bytes gauge
process_heap_bytes 999432192

# HELP process_open_fds Number of open file descriptors.
# TYPE process_open_fds gauge
process_open_fds 126

# HELP process_max_fds Maximum number of open file descriptors.
# TYPE process_max_fds gauge
process_max_fds 1048576

# HELP nodejs_eventloop_lag_seconds Lag of event loop in seconds.
# TYPE nodejs_eventloop_lag_seconds gauge
nodejs_eventloop_lag_seconds 0

# HELP nodejs_eventloop_lag_min_seconds The minimum recorded event loop delay.
# TYPE nodejs_eventloop_lag_min_seconds gauge
nodejs_eventloop_lag_min_seconds 0.009142272

# HELP nodejs_eventloop_lag_max_seconds The maximum recorded event loop delay.
# TYPE nodejs_eventloop_lag_max_seconds gauge
nodejs_eventloop_lag_max_seconds 0.028639231

# HELP nodejs_eventloop_lag_mean_seconds The mean of the recorded event loop delays.
# TYPE nodejs_eventloop_lag_mean_seconds gauge
nodejs_eventloop_lag_mean_seconds 0.010330466461538462

# HELP nodejs_eventloop_lag_stddev_seconds The standard deviation of the recorded event loop delays.
# TYPE nodejs_eventloop_lag_stddev_seconds gauge
nodejs_eventloop_lag_stddev_seconds 0.0016016882037877128

# HELP nodejs_eventloop_lag_p50_seconds The 50th percentile of the recorded event loop delays.
# TYPE nodejs_eventloop_lag_p50_seconds gauge
nodejs_eventloop_lag_p50_seconds 0.010166271

# HELP nodejs_eventloop_lag_p90_seconds The 90th percentile of the recorded event loop delays.
# TYPE nodejs_eventloop_lag_p90_seconds gauge
nodejs_eventloop_lag_p90_seconds 0.010313727

# HELP nodejs_eventloop_lag_p99_seconds The 99th percentile of the recorded event loop delays.
# TYPE nodejs_eventloop_lag_p99_seconds gauge
nodejs_eventloop_lag_p99_seconds 0.010715135

# HELP nodejs_active_resources Number of active resources that are currently keeping the event loop alive, grouped by async resource type.
# TYPE nodejs_active_resources gauge
nodejs_active_resources{type="MessagePort"} 1
nodejs_active_resources{type="TCPSocketWrap"} 1
nodejs_active_resources{type="Immediate"} 1

# HELP nodejs_active_resources_total Total number of active resources.
# TYPE nodejs_active_resources_total gauge
nodejs_active_resources_total 3

# HELP nodejs_active_handles Number of active libuv handles grouped by handle type. Every handle type is C++ class name.
# TYPE nodejs_active_handles gauge
nodejs_active_handles{type="MessagePort"} 1
nodejs_active_handles{type="Socket"} 1

# HELP nodejs_active_handles_total Total number of active handles.
# TYPE nodejs_active_handles_total gauge
nodejs_active_handles_total 2

# HELP nodejs_active_requests Number of active libuv requests grouped by request type. Every request type is C++ class name.
# TYPE nodejs_active_requests gauge

# HELP nodejs_active_requests_total Total number of active requests.
# TYPE nodejs_active_requests_total gauge
nodejs_active_requests_total 0

# HELP nodejs_heap_size_total_bytes Process heap size from Node.js in bytes.
# TYPE nodejs_heap_size_total_bytes gauge
nodejs_heap_size_total_bytes 101597184

# HELP nodejs_heap_size_used_bytes Process heap size used from Node.js in bytes.
# TYPE nodejs_heap_size_used_bytes gauge
nodejs_heap_size_used_bytes 85505848

# HELP nodejs_external_memory_bytes Node.js external memory size in bytes.
# TYPE nodejs_external_memory_bytes gauge
nodejs_external_memory_bytes 2811092

# HELP nodejs_heap_space_size_total_bytes Process heap space size total from Node.js in bytes.
# TYPE nodejs_heap_space_size_total_bytes gauge
nodejs_heap_space_size_total_bytes{space="read_only"} 0
nodejs_heap_space_size_total_bytes{space="new"} 16777216
nodejs_heap_space_size_total_bytes{space="old"} 75325440
nodejs_heap_space_size_total_bytes{space="code"} 3932160
nodejs_heap_space_size_total_bytes{space="shared"} 0
nodejs_heap_space_size_total_bytes{space="new_large_object"} 0
nodejs_heap_space_size_total_bytes{space="large_object"} 5562368
nodejs_heap_space_size_total_bytes{space="code_large_object"} 0
nodejs_heap_space_size_total_bytes{space="shared_large_object"} 0

# HELP nodejs_heap_space_size_used_bytes Process heap space size used from Node.js in bytes.
# TYPE nodejs_heap_space_size_used_bytes gauge
nodejs_heap_space_size_used_bytes{space="read_only"} 0
nodejs_heap_space_size_used_bytes{space="new"} 5857032
nodejs_heap_space_size_used_bytes{space="old"} 70760752
nodejs_heap_space_size_used_bytes{space="code"} 3451168
nodejs_heap_space_size_used_bytes{space="shared"} 0
nodejs_heap_space_size_used_bytes{space="new_large_object"} 0
nodejs_heap_space_size_used_bytes{space="large_object"} 5442296
nodejs_heap_space_size_used_bytes{space="code_large_object"} 0
nodejs_heap_space_size_used_bytes{space="shared_large_object"} 0

# HELP nodejs_heap_space_size_available_bytes Process heap space size available from Node.js in bytes.
# TYPE nodejs_heap_space_size_available_bytes gauge
nodejs_heap_space_size_available_bytes{space="read_only"} 0
nodejs_heap_space_size_available_bytes{space="new"} 2390008
nodejs_heap_space_size_available_bytes{space="old"} 3196392
nodejs_heap_space_size_available_bytes{space="code"} 234512
nodejs_heap_space_size_available_bytes{space="shared"} 0
nodejs_heap_space_size_available_bytes{space="new_large_object"} 8388608
nodejs_heap_space_size_available_bytes{space="large_object"} 0
nodejs_heap_space_size_available_bytes{space="code_large_object"} 0
nodejs_heap_space_size_available_bytes{space="shared_large_object"} 0

# HELP nodejs_version_info Node.js version info.
# TYPE nodejs_version_info gauge
nodejs_version_info{version="v20.0.0",major="20",minor="0",patch="0"} 1

# HELP nodejs_gc_duration_seconds Garbage collection duration by kind, one of major, minor, incremental or weakcb.
# TYPE nodejs_gc_duration_seconds histogram

# HELP harperdb_table_puts_total Total number of non-delete writes by table
# TYPE harperdb_table_puts_total gauge
harperdb_table_puts_total{database="dev",table="breed"} 0
harperdb_table_puts_total{database="dev",table="dog"} 0

# HELP harperdb_table_deletes_total Total number of deletes by table
# TYPE harperdb_table_deletes_total gauge
harperdb_table_deletes_total{database="dev",table="breed"} 0
harperdb_table_deletes_total{database="dev",table="dog"} 0

# HELP harperdb_table_txns_total Total number of transactions by table
# TYPE harperdb_table_txns_total gauge
harperdb_table_txns_total{database="dev",table="breed"} 33
harperdb_table_txns_total{database="dev",table="dog"} 44

# HELP harperdb_table_page_flushes_total Total number of times all pages are flushed by table
# TYPE harperdb_table_page_flushes_total gauge
harperdb_table_page_flushes_total{database="dev",table="breed"} 0
harperdb_table_page_flushes_total{database="dev",table="dog"} 0

# HELP harperdb_table_writes_total Total number of disk write operations by table
# TYPE harperdb_table_writes_total gauge
harperdb_table_writes_total{database="dev",table="breed"} 0
harperdb_table_writes_total{database="dev",table="dog"} 0

# HELP harperdb_table_pages_written_total Total number of pages written to disk by table. This is higher than writes because sequential pages can be written in a single write operation.
# TYPE harperdb_table_pages_written_total gauge
harperdb_table_pages_written_total{database="dev",table="breed"} 0
harperdb_table_pages_written_total{database="dev",table="dog"} 0

# HELP harperdb_table_time_during_txns_total Total time from when transaction was started (lock acquired) until finished and all writes have been made (but not necessarily flushed/synced to disk) by table
# TYPE harperdb_table_time_during_txns_total gauge
harperdb_table_time_during_txns_total{database="dev",table="breed"} 0.000553673
harperdb_table_time_during_txns_total{database="dev",table="dog"} 0.00073347

# HELP harperdb_table_time_start_txns_total Total time spent waiting for transaction lock acquisition by table
# TYPE harperdb_table_time_start_txns_total gauge
harperdb_table_time_start_txns_total{database="dev",table="breed"} 0.000012615
harperdb_table_time_start_txns_total{database="dev",table="dog"} 0.000014742

# HELP harperdb_table_time_page_flushes_total Total time spent on write calls by table
# TYPE harperdb_table_time_page_flushes_total gauge
harperdb_table_time_page_flushes_total{database="dev",table="breed"} 0
harperdb_table_time_page_flushes_total{database="dev",table="dog"} 0

# HELP harperdb_table_time_sync_total Total time spent waiting for writes to sync/flush to disk by table
# TYPE harperdb_table_time_sync_total gauge
harperdb_table_time_sync_total{database="dev",table="breed"} 0
harperdb_table_time_sync_total{database="dev",table="dog"} 0

# HELP harperdb_process_threads_count Number of threads in the Harper core process
# TYPE harperdb_process_threads_count gauge
harperdb_process_threads_count 6

# HELP harperdb_process_cpu_utilization CPU utilization of a Harper process
# TYPE harperdb_process_cpu_utilization gauge
harperdb_process_cpu_utilization{process_name="harperdb_core"} 0.00028240014775250785
harperdb_process_cpu_utilization{process_name="harperdb_clustering_hub"} 0.001069399009124807
harperdb_process_cpu_utilization{process_name="harperdb_clustering_leaf"} 0.0011405463331709813

# HELP filesystem_size_bytes Filesystem size in bytes.
# TYPE filesystem_size_bytes gauge
filesystem_size_bytes{device="none",fstype="9p",mountpoint="/usr/lib/wsl/drivers"} 490835275776
filesystem_size_bytes{device="/dev/sdc",fstype="ext4",mountpoint="/"} 269427478528
filesystem_size_bytes{device="none",fstype="overlay",mountpoint="/usr/lib/wsl/lib"} 8299667456
filesystem_size_bytes{device="drvfs",fstype="9p",mountpoint="/mnt/c"} 490835275776
filesystem_size_bytes{device="/dev/sde",fstype="ext4",mountpoint="/mnt/wsl/docker-desktop-data/isocache"} 1081101176832
filesystem_size_bytes{device="/dev/sdd",fstype="ext4",mountpoint="/mnt/wsl/docker-desktop/docker-desktop-user-distro"} 1081101176832
filesystem_size_bytes{device="/dev/loop0",fstype="iso9660",mountpoint="/mnt/wsl/docker-desktop/cli-tools"} 463595520

# HELP filesystem_free_bytes Filesystem free space in bytes.
# TYPE filesystem_free_bytes gauge
filesystem_free_bytes{device="none",fstype="9p",mountpoint="/usr/lib/wsl/drivers"} 120824410112
filesystem_free_bytes{device="/dev/sdc",fstype="ext4",mountpoint="/"} 227734966272
filesystem_free_bytes{device="none",fstype="overlay",mountpoint="/usr/lib/wsl/lib"} 8299667456
filesystem_free_bytes{device="drvfs",fstype="9p",mountpoint="/mnt/c"} 120824410112
filesystem_free_bytes{device="/dev/sde",fstype="ext4",mountpoint="/mnt/wsl/docker-desktop-data/isocache"} 1015033745408
filesystem_free_bytes{device="/dev/sdd",fstype="ext4",mountpoint="/mnt/wsl/docker-desktop/docker-desktop-user-distro"} 1026045915136
filesystem_free_bytes{device="/dev/loop0",fstype="iso9660",mountpoint="/mnt/wsl/docker-desktop/cli-tools"} 0

# HELP filesystem_used_bytes Filesystem space used in bytes.
# TYPE filesystem_used_bytes gauge
filesystem_used_bytes{device="none",fstype="9p",mountpoint="/usr/lib/wsl/drivers"} 75.38
filesystem_used_bytes{device="/dev/sdc",fstype="ext4",mountpoint="/"} 10.93
filesystem_used_bytes{device="none",fstype="overlay",mountpoint="/usr/lib/wsl/lib"} 0
filesystem_used_bytes{device="drvfs",fstype="9p",mountpoint="/mnt/c"} 75.38
filesystem_used_bytes{device="/dev/sde",fstype="ext4",mountpoint="/mnt/wsl/docker-desktop-data/isocache"} 1.08
filesystem_used_bytes{device="/dev/sdd",fstype="ext4",mountpoint="/mnt/wsl/docker-desktop/docker-desktop-user-distro"} 0.01
filesystem_used_bytes{device="/dev/loop0",fstype="iso9660",mountpoint="/mnt/wsl/docker-desktop/cli-tools"} 100
```
