/* eslint max-lines: 0 */
import React, { Component } from "react";
import classNames from "classnames";
import Autosuggest from "react-autosuggest";
import {
	TYPES,
	AppbaseChannelManager as manager,
	AppbaseSensorHelper as helper
} from "@appbaseio/reactivemaps";
import _ from "lodash";

export default class CategorySearch extends Component {
	constructor(props) {
		super(props);
		this.state = {
			items: [],
			currentValue: {
				label: null,
				value: null
			},
			isLoading: false,
			options: [],
			rawData: {
				hits: {
					hits: []
				}
			}
		};
		this.selectedCategory = null;
		this.searchInputId = `internal-${props.componentId}`;
		this.type = "match_phrase";
		this.channelId = null;
		this.channelListener = null;
		this.urlParams = helper.URLParams.get(this.props.componentId);
		this.fieldType = typeof props.appbaseField;
		this.handleSearch = this.handleSearch.bind(this);
		this.optionRenderer = this.optionRenderer.bind(this);
		this.setValue = this.setValue.bind(this);
		this.defaultSearchQuery = this.defaultSearchQuery.bind(this);
		this.previousSelectedSensor = {};
		this.clearSuggestions = this.clearSuggestions.bind(this);
		this.onSuggestionSelected = this.onSuggestionSelected.bind(this);
		this.getSuggestionValue = this.getSuggestionValue.bind(this);
		this.onInputChange = this.onInputChange.bind(this);
		this.handleBlur = this.handleBlur.bind(this);
		this.handleKeyPress = this.handleKeyPress.bind(this);
		this.handleInputChange = this.handleInputChange.bind(this);
		this.renderSuggestion = this.renderSuggestion.bind(this);
	}

	// Get the items from Appbase when component is mounted
	componentWillMount() {
		this.setQueryInfo();
		this.createChannel();
		this.checkDefault();
		this.listenFilter();
	}

	componentWillUpdate() {
		this.checkDefault();
	}

	// stop streaming request and remove listener when component will unmount
	componentWillUnmount() {
		if (this.channelId) {
			manager.stopStream(this.channelId);
		}
		if (this.channelListener) {
			this.channelListener.remove();
		}
		if(this.filterListener) {
			this.filterListener.remove();
		}
	}


	listenFilter() {
		this.filterListener = helper.sensorEmitter.addListener("clearFilter", (data) => {
			if(data === this.props.componentId) {
				this.defaultValue = "";
				this.changeValue(this.defaultValue);
			}
		});
	}

	highlightQuery() {
		const fields = {};
		const highlightFields = this.props.highlightFields ? this.props.highlightFields : this.props.appbaseField;
		if (typeof highlightFields === "string") {
			fields[highlightFields] = {};
		} else if (_.isArray(highlightFields)) {
			highlightFields.forEach((item) => {
				fields[item] = {};
			});
		}
		return {
			highlight: {
				pre_tags: ["<span class=\"rbc-highlight\">"],
				post_tags: ["</span>"],
				fields
			}
		};
	}

	// set the query type and input data
	setQueryInfo() {
		const obj = {
			key: this.props.componentId,
			value: {
				queryType: this.type,
				inputData: this.props.appbaseField,
				customQuery: this.props.customQuery ? this.props.customQuery : this.defaultSearchQuery,
				reactiveId: this.context.reactiveId,
				showFilter: this.props.showFilter,
				filterLabel: this.props.filterLabel ? this.props.filterLabel : this.props.componentId,
				component: "CategorySearch",
				defaultSelected: this.urlParams !== null ? this.urlParams : this.props.defaultSelected
			}
		};
		if (this.props.highlight) {
			obj.value.externalQuery = this.highlightQuery();
		}
		helper.selectedSensor.setSensorInfo(obj);
		const searchObj = {
			key: this.searchInputId,
			value: {
				queryType: "multi_match",
				inputData: this.props.appbaseField,
				customQuery: this.defaultSearchQuery
			}
		};
		helper.selectedSensor.setSensorInfo(searchObj);
	}

	// set value to search
	setValue(value) {
		const obj = {
			key: this.searchInputId,
			value: value === null ? null : { value }
		};
		helper.selectedSensor.set(obj, true);

		if (value && value.trim() !== "") {
			this.setState({
				options: [{
					label: value,
					value
				}],
				isLoadingOptions: true,
				currentValue: {
					label: value,
					value
				}
			});
		} else {
			this.setState({
				options: [],
				isLoadingOptions: false,
				currentValue: {
					label: value,
					value
				}
			});
		}
	}

	removeDuplicates(myArr, prop) {
		return myArr.filter((obj, pos, arr) => arr.map(mapObj => mapObj[prop]).indexOf(obj[prop]) === pos);
	}

	// default query
	defaultSearchQuery(input) {
		if (input && input.value) {
			let query = [];
			const appbaseField = this.fieldType === "string" ? [this.props.appbaseField] : this.props.appbaseField;
			appbaseField.forEach((field, index) => {
				const queryObj = {
					match_phrase_prefix: {
						[field]: {
							query: input.value
						}
					}
				};
				if(this.props.weights && this.props.weights[index]) {
					queryObj.match_phrase_prefix[field].boost = this.props.weights[index];
				}
				query.push(queryObj);
			});

			if (input.category && input.category !== null) {
				query = {
					bool: {
						should: query,
						minimum_should_match: 1
					}
				};
				return {
					bool: {
						must: [query, {
							term: {
								[this.props.categoryField]: input.category
							}
						}]
					}
				};
			}

			return {
				bool: {
					should: query,
					minimum_should_match: 1
				}
			};
		}
		return null;
	}

	// Create a channel which passes the react and receive results whenever react changes
	createChannel() {
		let react = this.props.react ? this.props.react : {};
		react.aggs = {
			key: this.props.categoryField
		};
		const reactAnd = [this.searchInputId];
		react = helper.setupReact(react, reactAnd);
		const channelObj = manager.create(this.context.appbaseRef, this.context.type, react, 100, 0, false, this.props.componentId);
		this.channelId = channelObj.channelId;
		this.channelListener = channelObj.emitter.addListener(channelObj.channelId, (res) => {
			const data = res.data;
			let rawData;
			if (res.mode === "streaming") {
				rawData = this.state.rawData;
				rawData.hits.hits.push(res.data);
			} else if (res.mode === "historic") {
				rawData = data;
			}
			this.setState({
				rawData
			});
			this.setData(rawData, res.appliedQuery.body.query);
		});
		this.listenLoadingChannel(channelObj);
	}

	listenLoadingChannel(channelObj) {
		this.loadListener = channelObj.emitter.addListener(`${channelObj.channelId}-query`, (res) => {
			if (res.appliedQuery) {
				this.setState({
					queryStart: res.queryState
				});
			}
		});
	}

	onInputChange(event, { method, newValue }) {
		if (method === "type") {
			this.setValue(newValue);
		}
	}

	setData(data, loadSuggestions) {
		let aggs = [];
		let options = [];
		let searchField = null;
		if (data.aggregations && data.aggregations[this.props.categoryField] && data.aggregations[this.props.categoryField].buckets) {
			aggs = (data.aggregations[this.props.categoryField].buckets).slice(0, 2);
		}

		if (loadSuggestions) {
			if (this.fieldType === "string") {
				searchField = `hit._source.${this.props.appbaseField}.trim()`;
			}
			data.hits.hits.forEach((hit) => {
				if (searchField) {
					options.push({ value: eval(searchField), label: eval(searchField) });
				} else if (this.fieldType === "object") {
					this.props.appbaseField.forEach((field) => {
						const tempField = `hit._source.${field}`;
						if (eval(tempField)) {
							options.push({ value: eval(tempField), label: eval(tempField) });
						}
					});
				}
			});
			if (this.state.currentValue.value && this.state.currentValue.value.trim() !== "" && aggs.length) {
				const suggestions = [
					{
						label: this.state.currentValue.label,
						markup: `${this.state.currentValue.label} &nbsp;<span class="rbc-strong">in All Categories</span>`,
						value: this.state.currentValue.value
					},
					{
						label: this.state.currentValue.label,
						markup: `${this.state.currentValue.label} &nbsp;<span class="rbc-strong">in ${aggs[0].key}</span>`,
						value: `${this.state.currentValue.value}--rbc1`,
						category: aggs[0].key
					}
				];

				if (aggs.length > 1) {
					suggestions.push({
						label: this.state.currentValue.label,
						markup: `${this.state.currentValue.label} &nbsp;<span class="rbc-strong">in ${aggs[1].key}</span>`,
						value: `${this.state.currentValue.value}--rbc2`,
						category: aggs[1].key
					});
				}
				options.unshift(...suggestions);
			}
			options = this.removeDuplicates(options, "value");
			this.setState({
				options,
				isLoadingOptions: false
			});
		}
	}

	clearSuggestions() {
		this.setState({
			options: []
		});
	}

	onSuggestionSelected(event, { suggestion }) {
		this.handleSearch(suggestion);
	}

	getSuggestionValue(suggestion) {
		return suggestion.label;
	}

	checkDefault() {
		const defaultValue = this.urlParams !== null ? this.urlParams : this.props.defaultSelected;
		this.changeValue(defaultValue);
	}

	changeValue(defaultValue) {
		if (this.defaultSelected !== defaultValue) {
			this.defaultSelected = defaultValue;
			this.setValue(this.defaultSelected);
			this.handleSearch({
				value: this.defaultSelected
			});
		}
	}

	// When user has selected a search value
	handleSearch(currentValue) {
		const value = currentValue ? currentValue.value : null;
		const finalVal = value ? { value } : null;

		if (currentValue && currentValue.category) {
			finalVal.category = currentValue.category;
			finalVal.value = finalVal.value.slice(0, -6);
		} else {
			if(finalVal) {
				finalVal.category = null;
			}
		}

		const obj = {
			key: this.props.componentId,
			value: finalVal
		};

		if(this.props.onValueChange) {
			this.props.onValueChange(obj.value);
		}
		helper.URLParams.update(this.props.componentId, finalVal ? finalVal.value : null, this.props.URLParams);
		helper.selectedSensor.set(obj, true);
		this.setState({
			currentValue: {
				label: finalVal.value,
				value
			}
		});
	}

	handleBlur(event, { highlightedSuggestion }) {
		if (!highlightedSuggestion || !highlightedSuggestion.label) {
			if (this.state.currentValue.label) {
				this.handleSearch({
					value: this.state.currentValue.label
				});
			}
		}
	}

	handleKeyPress(event) {
		if (event.key === "Enter") {
			event.target.blur();
		}
	}

	handleInputChange(event) {
		const inputVal = event.target.value;
		this.setState({
			currentValue: {
				label: inputVal,
				value: inputVal
			}
		});
		if (inputVal) {
			this.handleSearch({
				value: inputVal
			});
		}
	}

	optionRenderer(option) {
		if (option.markup) {
			return (<div key={option.value} dangerouslySetInnerHTML={{ __html: option.markup }} />);
		}

		return (<div key={option.value}>{option.label}</div>);
	}

	renderSuggestion(suggestion) {
		return this.optionRenderer(suggestion);
	}

	render() {
		let title = null;
		if (this.props.title) {
			title = (<h4 className="rbc-title col s12 col-xs-12">{this.props.title}</h4>);
		}
		const cx = classNames({
			"rbc-title-active": this.props.title,
			"rbc-title-inactive": !this.props.title,
			"rbc-placeholder-active": this.props.placeholder,
			"rbc-placeholder-inactive": !this.props.placeholder,
			"rbc-autoSuggest-active": this.props.autoSuggest,
			"rbc-autoSuggest-inactive": !this.props.autoSuggest
		});

		return (
			<div className={`rbc rbc-categorysearch col s12 col-xs-12 card thumbnail ${cx} ${this.state.isLoadingOptions ? "is-loading" : ""}`} style={this.props.componentStyle}>
				{title}
				{
					this.props.autoSuggest ?
						<Autosuggest
							suggestions={this.state.options}
							onSuggestionsFetchRequested={() => {}}
							onSuggestionsClearRequested={this.clearSuggestions}
							onSuggestionSelected={this.onSuggestionSelected}
							getSuggestionValue={this.getSuggestionValue}
							renderSuggestion={this.renderSuggestion}
							focusInputOnSuggestionClick={false}
							inputProps={{
								placeholder: this.props.placeholder,
								value: this.state.currentValue.label ? this.state.currentValue.label : "",
								onChange: this.onInputChange,
								onBlur: this.handleBlur,
								onKeyPress: this.handleKeyPress
							}}
						/> :
						<div className="rbc-search-container col s12 col-xs-12">
							<input
								type="text"
								className="rbc-input"
								placeholder={this.props.placeholder}
								value={this.state.currentValue.label ? this.state.currentValue.label : ""}
								onChange={this.handleInputChange}
							/>
							<span className="rbc-search-icon" />
						</div>
				}
			</div>
		);
	}
}

CategorySearch.propTypes = {
	componentId: React.PropTypes.string.isRequired,
	appbaseField: React.PropTypes.oneOfType([
		React.PropTypes.string,
		React.PropTypes.arrayOf(React.PropTypes.string)
	]),
	weights: React.PropTypes.arrayOf(React.PropTypes.number),
	title: React.PropTypes.oneOfType([
		React.PropTypes.string,
		React.PropTypes.element
	]),
	categoryField: React.PropTypes.string,
	placeholder: React.PropTypes.string,
	autoSuggest: React.PropTypes.bool,
	defaultSelected: React.PropTypes.string,
	customQuery: React.PropTypes.func,
	react: React.PropTypes.object,
	onValueChange: React.PropTypes.func,
	highlight: React.PropTypes.bool,
	highlightFields: React.PropTypes.oneOfType([
		React.PropTypes.string,
		React.PropTypes.arrayOf(React.PropTypes.string)
	]),
	componentStyle: React.PropTypes.object,
	URLParams: React.PropTypes.bool,
	showFilter: React.PropTypes.bool,
	filterLabel: React.PropTypes.string
};

// Default props value
CategorySearch.defaultProps = {
	placeholder: "Search",
	autoSuggest: true,
	highlight: false,
	componentStyle: {},
	URLParams: false,
	showFilter: true
};

// context type
CategorySearch.contextTypes = {
	appbaseRef: React.PropTypes.any.isRequired,
	type: React.PropTypes.any.isRequired,
	reactiveId: React.PropTypes.number
};

CategorySearch.types = {
	componentId: TYPES.STRING,
	appbaseField: TYPES.STRING,
	appbaseFieldType: TYPES.KEYWORD,
	react: TYPES.OBJECT,
	title: TYPES.STRING,
	categoryField: TYPES.STRING,
	placeholder: TYPES.STRING,
	autoSuggest: TYPES.BOOLEAN,
	defaultSelected: TYPES.STRING,
	customQuery: TYPES.FUNCTION,
	highlight: TYPES.BOOLEAN,
	URLParams: TYPES.BOOLEAN,
	showFilter: TYPES.BOOLEAN,
	filterLabel: TYPES.STRING,
	weights: TYPES.OBJECT
};
